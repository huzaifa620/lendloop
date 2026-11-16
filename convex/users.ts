import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewer } from "./lib/access";

// Called by the client right after Clerk sign-in. Creates or refreshes the
// user row from the verified token; the client sends no arguments at all.
export const store = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first");

    // Data minimisation: keep a first name for display and the email for
    // notifications. Nothing else from the Clerk profile is stored.
    const name = (identity.givenName ?? identity.name ?? "Member").split(" ")[0];
    const email = identity.email;

    const existing = await getViewer(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch("users", existing._id, { name, email });
      }
      return null;
    }
    await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user", // everyone starts as a user; see setRole below
      trustedLender: false,
    });
    return null;
  },
});

export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      role: v.union(v.literal("admin"), v.literal("user")),
      trustedLender: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return { name: viewer.name, role: viewer.role, trustedLender: viewer.trustedLender };
  },
});

// Internal: not callable from the browser, only by someone holding the
// deployment's admin key:
//   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  returns: v.null(),
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new ConvexError(`No user with email ${email}; sign in once first`);
    await ctx.db.patch("users", user._id, { role });
    return null;
  },
});
