// Demo data for local runs. Internal, so only the CLI can call it:
//   npx convex run seed:demo
// It includes an approved loan that ended three days ago, so the daily
// reminder workflow has something to do on the first run.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/access";

const shift = (days: number) => todayUtc(Date.now() + days * 86_400_000);

export const demo = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    if (await ctx.db.query("tools").first()) return "Database already has tools; skipped.";

    const user = (key: string, name: string, trustedLender = false) =>
      ctx.db.insert("users", {
        tokenIdentifier: `demo|${key}`,
        name,
        email: `${key}@example.com`,
        role: "user",
        trustedLender,
      });
    const amara = await user("amara", "Amara", true);
    const bilal = await user("bilal", "Bilal");

    const tool = (ownerId: typeof amara, name: string, category: "power_tools" | "garden" | "kitchen" | "camping", description: string) =>
      ctx.db.insert("tools", { ownerId, name, category, condition: "good", description });
    const drill = await tool(amara, "Cordless drill", "power_tools", "18V, two batteries.");
    await tool(amara, "Hedge trimmer", "garden", "Electric, 50cm blade.");
    await tool(bilal, "Stand mixer", "kitchen", "5L bowl, dough hook included.");
    const tent = await tool(bilal, "4-person tent", "camping", "Pitches in 10 minutes.");

    await ctx.db.insert("loans", {
      toolId: drill, ownerId: amara, borrowerId: bilal,
      startDate: shift(-10), endDate: shift(-3), status: "approved", decidedAt: Date.now(),
    });
    await ctx.db.insert("loans", {
      toolId: tent, ownerId: bilal, borrowerId: amara,
      startDate: shift(5), endDate: shift(8), status: "pending",
    });
    return "Seeded 2 users, 4 tools, 1 overdue loan and 1 pending request.";
  },
});
