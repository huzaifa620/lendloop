import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { queueLoanNotification } from "./automation";
import {
  canDecideLoan,
  daysBetween,
  getViewer,
  isIsoDate,
  requireAdmin,
  requireUser,
  todayUtc,
} from "./lib/access";
import { loanStatus } from "./schema";

const MAX_LOAN_DAYS = 30;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  returns: v.id("loans"),
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool || tool.removedAt !== undefined) throw new ConvexError("Tool not found");
    if (tool.ownerId === viewer._id) throw new ConvexError("You can't borrow your own tool");

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new ConvexError("Dates must be YYYY-MM-DD");
    if (startDate < todayUtc()) throw new ConvexError("Start date can't be in the past");
    if (endDate < startDate) throw new ConvexError("End date must be on or after the start date");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) {
      throw new ConvexError(`Loans are limited to ${MAX_LOAN_DAYS} days`);
    }

    const alreadyPending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .filter((q) => q.eq(q.field("borrowerId"), viewer._id))
      .first();
    if (alreadyPending) throw new ConvexError("You already have a pending request for this tool");

    const loanId = await ctx.db.insert("loans", {
      toolId,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "pending",
    });
    await queueLoanNotification(ctx, (await ctx.db.get("loans", loanId))!, tool.name);
    return loanId;
  },
});

// One allowed transition per action. Anything else is rejected, which also
// makes a double-click or a retried request harmless.
const TRANSITIONS = {
  approve: { from: "pending", to: "approved" },
  decline: { from: "pending", to: "declined" },
  markReturned: { from: "approved", to: "returned" },
} as const;

async function transition(ctx: MutationCtx, loanId: Id<"loans">, action: keyof typeof TRANSITIONS) {
  const viewer = await requireUser(ctx);
  const loan = await ctx.db.get("loans", loanId);
  // Same message whether the loan doesn't exist or isn't yours: don't reveal
  // which loan ids exist to people who aren't part of them.
  if (!loan || !canDecideLoan(viewer, loan)) throw new ConvexError("Loan not found");

  const { from, to } = TRANSITIONS[action];
  if (loan.status !== from) throw new ConvexError(`Only a ${from} loan can be ${to}`);

  if (action === "approve") {
    const overlapping = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "approved"))
      .filter((q) =>
        q.and(q.lte(q.field("startDate"), loan.endDate), q.gte(q.field("endDate"), loan.startDate)),
      )
      .first();
    if (overlapping) throw new ConvexError("Those dates overlap a loan you already approved");
  }

  const now = Date.now();
  await ctx.db.patch("loans", loanId, {
    status: to,
    ...(action === "markReturned" ? { returnedAt: now } : { decidedAt: now }),
  });
  const tool = await ctx.db.get("tools", loan.toolId);
  await queueLoanNotification(ctx, { ...loan, status: to }, tool?.name ?? "a tool");
  return null;
}

const loanIdArg = { loanId: v.id("loans") };
export const approve = mutation({ args: loanIdArg, returns: v.null(), handler: (ctx, a) => transition(ctx, a.loanId, "approve") });
export const decline = mutation({ args: loanIdArg, returns: v.null(), handler: (ctx, a) => transition(ctx, a.loanId, "decline") });
export const markReturned = mutation({ args: loanIdArg, returns: v.null(), handler: (ctx, a) => transition(ctx, a.loanId, "markReturned") });

// ---------------------------------------------------------------------------
// Reads: each view returns only the other party's first name
// ---------------------------------------------------------------------------

const activity = v.array(
  v.object({
    kind: v.union(v.literal("notification"), v.literal("reminder"), v.literal("webhook_delivery")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    at: v.number(),
    // Which loan transition a notification was about, e.g. "approved".
    about: v.union(loanStatus, v.null()),
  }),
);

const LOAN_STATUSES = ["pending", "approved", "declined", "returned"] as const;

// Notification keys end in the transition ("notification:<loanId>:approved",
// see queueLoanNotification). The key arrived from n8n, so only an exact
// known status is shown; anything else displays as a plain notification.
function transitionFromKey(key: string) {
  const last = key.split(":").pop();
  return LOAN_STATUSES.find((s) => s === last) ?? null;
}

const loanView = v.object({
  _id: v.id("loans"),
  toolName: v.string(),
  otherPartyName: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  status: loanStatus,
  overdue: v.boolean(),
  activity,
});

async function toView(ctx: QueryCtx, loan: Doc<"loans">, otherPartyId: Id<"users">, today: string) {
  const [tool, other, events] = await Promise.all([
    ctx.db.get("tools", loan.toolId),
    ctx.db.get("users", otherPartyId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(3),
  ]);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed tool",
    otherPartyName: other?.name ?? "Member",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    activity: events.map(({ kind, status, at, key }) => ({
      kind,
      status,
      at,
      about: kind === "reminder" ? null : transitionFromKey(key),
    })),
  };
}

// "My requests": loans where I'm the borrower.
export const mine = query({
  args: {},
  returns: v.array(loanView),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => toView(ctx, l, l.ownerId, today)));
  },
});

// "Incoming requests": loans on tools I own.
export const incoming = query({
  args: {},
  returns: v.array(loanView),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => toView(ctx, l, l.borrowerId, today)));
  },
});

// Admin: every loan, with both parties' first names.
export const all = query({
  args: {},
  returns: v.array(v.object({ ...loanView.fields, lenderName: v.string() })),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = todayUtc();
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return Promise.all(
      loans.map(async (l) => {
        const lender = await ctx.db.get("users", l.ownerId);
        return { ...(await toView(ctx, l, l.borrowerId, today)), lenderName: lender?.name ?? "Member" };
      }),
    );
  },
});
