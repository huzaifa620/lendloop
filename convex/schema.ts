import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const category = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("other"),
);

export const condition = v.union(
  v.literal("new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

// A loan starts life as a borrow request ("pending") and moves through
// approved -> returned, or ends at declined. Each status is entered at most
// once, which is what makes `${loanId}:${status}` a safe idempotency key.
export const loanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(), // issuer + subject from the verified Clerk JWT
    name: v.string(), // first name only: it is what other members see
    email: v.optional(v.string()), // only used to address notifications
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
    // Soft delete: loans keep pointing at a real document after a listing is removed.
    removedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("active_by_category", ["removedAt", "category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"), // denormalised from the tool so "incoming" is one index read
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD, a calendar date with no time zone
    endDate: v.string(),
    status: loanStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // What the automations did for each loan. `key` is the idempotency key:
  // n8n retries that send the same key update one row instead of adding rows.
  automationEvents: defineTable({
    key: v.string(),
    loanId: v.id("loans"),
    kind: v.union(
      v.literal("notification"),
      v.literal("reminder"),
      v.literal("webhook_delivery"),
    ),
    status: v.union(v.literal("sent"), v.literal("failed")),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"]),
});
