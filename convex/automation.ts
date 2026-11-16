// Everything that crosses the Convex <-> n8n boundary.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { daysBetween } from "./lib/access";
import { signatureHeaders } from "./lib/hmac";

const MAX_DELIVERY_ATTEMPTS = 5;
const backoffMs = (attempt: number) => 30_000 * 2 ** attempt; // 30s, 1m, 2m, 4m

// ---------------------------------------------------------------------------
// Convex -> n8n: loan status notifications
// ---------------------------------------------------------------------------

// Called from inside a loan mutation. Scheduling from a mutation is
// transactional: if the mutation fails, no webhook is ever sent, and if it
// commits, the send is guaranteed to be attempted (a built-in outbox).
export async function queueLoanNotification(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  toolName: string,
) {
  // Exactly one person needs to hear about each transition.
  const recipientId = loan.status === "pending" ? loan.ownerId : loan.borrowerId;
  const recipient = await ctx.db.get("users", recipientId);
  if (!recipient) return;

  // Data minimisation: n8n gets what it needs to write one message to one
  // person. No tool description, no other party's email, no internal user ids.
  const body = JSON.stringify({
    eventId: `${loan._id}:${loan.status}`, // idempotency key for this transition
    type: `loan.${loan.status}`,
    loanId: loan._id,
    status: loan.status,
    toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    recipient: { name: recipient.name, email: recipient.email ?? null },
  });

  await ctx.scheduler.runAfter(0, internal.automation.deliver, {
    body,
    eventId: `${loan._id}:${loan.status}`,
    loanId: loan._id,
    attempt: 0,
  });
}

export const deliver = internalAction({
  args: { body: v.string(), eventId: v.string(), loanId: v.id("loans"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const url = process.env.N8N_NOTIFY_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    if (!url || !secret) {
      // Never send unsigned. Missing config is logged loudly, not silently skipped.
      console.warn(`[notify] N8N_NOTIFY_WEBHOOK_URL or LENDLOOP_WEBHOOK_SECRET unset; not sending ${args.eventId}`);
      return null;
    }

    let failure: string;
    let retryable = true;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await signatureHeaders(secret, args.body)) },
        body: args.body,
      });
      if (res.ok) return null;
      failure = `HTTP ${res.status}`;
      // A 4xx (bad signature, bad payload) will fail the same way again.
      retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err); // network error, n8n down
    }

    if (retryable && args.attempt + 1 < MAX_DELIVERY_ATTEMPTS) {
      console.warn(`[notify] ${args.eventId} attempt ${args.attempt + 1} failed (${failure}); retrying`);
      await ctx.scheduler.runAfter(backoffMs(args.attempt), internal.automation.deliver, {
        ...args,
        attempt: args.attempt + 1,
      });
      return null;
    }

    console.error(`[notify] ${args.eventId} gave up after ${args.attempt + 1} attempts: ${failure}`);
    await ctx.runMutation(internal.automation.recordActivity, {
      key: `webhook_delivery:${args.eventId}`,
      loanId: args.loanId,
      kind: "webhook_delivery",
      status: "failed",
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// n8n -> Convex: write-backs (via convex/http.ts, after signature checks)
// ---------------------------------------------------------------------------

const activityKind = v.union(v.literal("notification"), v.literal("reminder"), v.literal("webhook_delivery"));
const activityStatus = v.union(v.literal("sent"), v.literal("failed"));

// Idempotent upsert keyed on `key`. A Convex mutation is a serialisable
// transaction, so "look up by key, then insert" cannot race into two rows
// even when n8n retries in parallel.
export const recordActivity = internalMutation({
  args: { key: v.string(), loanId: v.string(), kind: activityKind, status: activityStatus },
  returns: v.union(v.literal("created"), v.literal("updated"), v.literal("duplicate"), v.literal("unknown_loan")),
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || !(await ctx.db.get("loans", loanId))) return "unknown_loan";

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!existing) {
      await ctx.db.insert("automationEvents", { ...args, loanId, at: Date.now() });
      return "created";
    }
    // A retry that finally succeeded upgrades failed -> sent. A late "failed"
    // never downgrades a "sent", and a repeated "sent" changes nothing.
    if (existing.status === "failed" && args.status === "sent") {
      await ctx.db.patch("automationEvents", existing._id, { status: "sent", at: Date.now() });
      return "updated";
    }
    return "duplicate";
  },
});

export const reminderKey = (loanId: Id<"loans">, today: string) => `reminder:${loanId}:${today}`;

// Approved loans whose end date has passed and that have not had a reminder
// recorded as sent today. Re-running the daily job therefore cannot re-send
// a reminder that already went out.
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  returns: v.array(
    v.object({
      loanId: v.id("loans"),
      reminderKey: v.string(),
      toolName: v.string(),
      endDate: v.string(),
      daysOverdue: v.number(),
      borrower: v.object({ name: v.string(), email: v.union(v.string(), v.null()) }),
    }),
  ),
  handler: async (ctx, { today }) => {
    // Known limit: first 100 per run; paginate if a single day ever has more.
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(100);

    const result = [];
    for (const loan of loans) {
      const key = reminderKey(loan._id, today);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (already?.status === "sent") continue;

      const [tool, borrower] = await Promise.all([
        ctx.db.get("tools", loan.toolId),
        ctx.db.get("users", loan.borrowerId),
      ]);
      if (!tool || !borrower) continue;
      result.push({
        loanId: loan._id,
        reminderKey: key,
        toolName: tool.name,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email ?? null },
      });
    }
    return result;
  },
});
