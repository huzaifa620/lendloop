import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { queueLoanNotification } from "./automation";
import {
  canEditTool,
  canRemoveTool,
  cleanText,
  getViewer,
  requireUser,
  todayUtc,
} from "./lib/access";
import { category, condition } from "./schema";

// Public landing page. No auth, so it returns name + category and nothing
// that identifies a person. The `returns` validator makes that a contract:
// adding a field to the table cannot leak it here by accident.
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("tools"), name: v.string(), category })),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("active_by_category", (q) => q.eq("removedAt", undefined))
      .order("desc")
      .take(200); // Known limit: first 200; paginate when the catalogue grows
    return tools.map(({ _id, name, category }) => ({ _id, name, category }));
  },
});

const toolView = v.object({
  _id: v.id("tools"),
  name: v.string(),
  category,
  condition,
  description: v.string(),
  ownerName: v.string(),
  ownerTrusted: v.boolean(),
  isMine: v.boolean(),
  available: v.boolean(),
  dueBack: v.union(v.string(), v.null()),
});

// Known limit: one indexed lookup per tool; denormalise an `onLoanUntil` field if lists get long.
async function availability(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  const current = approved.find((l) => l.startDate <= today);
  return { available: !current, dueBack: current?.endDate ?? null };
}

async function toView(ctx: QueryCtx, tool: Doc<"tools">, viewerId: Id<"users">, today: string) {
  const owner = await ctx.db.get("users", tool.ownerId);
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    ownerName: owner?.name ?? "Member",
    ownerTrusted: owner?.trustedLender ?? false,
    isMine: tool.ownerId === viewerId,
    ...(await availability(ctx, tool._id, today)),
  };
}

export const list = query({
  args: { category: v.optional(category) },
  returns: v.array(toolView),
  handler: async (ctx, args) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("active_by_category", (q) =>
        args.category
          ? q.eq("removedAt", undefined).eq("category", args.category)
          : q.eq("removedAt", undefined),
      )
      .order("desc")
      .take(200);
    return Promise.all(tools.map((t) => toView(ctx, t, viewer._id, today)));
  },
});

export const mine = query({
  args: {},
  returns: v.array(toolView),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    return Promise.all(
      tools.filter((t) => t.removedAt === undefined).map((t) => toView(ctx, t, viewer._id, today)),
    );
  },
});

const editableFields = {
  name: v.string(),
  category,
  condition,
  description: v.string(),
};

function cleanFields(args: { name: string; description: string }) {
  return {
    name: cleanText(args.name, "Name", 80),
    description: cleanText(args.description, "Description", 500, 0),
  };
}

export const create = mutation({
  args: editableFields,
  returns: v.id("tools"),
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    // ownerId comes from the verified identity, never from the client.
    return await ctx.db.insert("tools", {
      ...cleanFields(args),
      category: args.category,
      condition: args.condition,
      ownerId: viewer._id,
    });
  },
});

async function loadActiveTool(ctx: QueryCtx, toolId: Id<"tools">) {
  const tool = await ctx.db.get("tools", toolId);
  if (!tool || tool.removedAt !== undefined) throw new ConvexError("Tool not found");
  return tool;
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...editableFields },
  returns: v.null(),
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireUser(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    if (!canEditTool(viewer, tool)) throw new ConvexError("You can only edit your own listings");
    await ctx.db.patch("tools", toolId, {
      ...cleanFields(args),
      category: args.category,
      condition: args.condition,
    });
    return null;
  },
});

// Owners remove their own listings; admins can remove any listing.
// Pending requests are declined (and the borrower told). A loan that is
// already out stays approved: the tool still has to come back.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const viewer = await requireUser(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    if (!canRemoveTool(viewer, tool)) throw new ConvexError("You can only remove your own listings");

    await ctx.db.patch("tools", toolId, { removedAt: Date.now() });
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    for (const loan of pending) {
      await ctx.db.patch("loans", loan._id, { status: "declined", decidedAt: Date.now() });
      await queueLoanNotification(ctx, { ...loan, status: "declined" }, tool.name);
    }
    return null;
  },
});
