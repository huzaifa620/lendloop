import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/access";

// Listing removal for admins is tools.remove (it already allows admins), and
// "view all loans" is loans.all. This file holds the admin-only user actions.

export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      email: v.union(v.string(), v.null()),
      role: v.union(v.literal("admin"), v.literal("user")),
      trustedLender: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email ?? null,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    await ctx.db.patch("users", userId, { trustedLender: trusted });
    return null;
  },
});
