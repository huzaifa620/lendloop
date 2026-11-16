/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Loan mutations schedule a webhook delivery. Fake timers keep those queued
// so these tests only exercise the authorisation rules.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
});

async function setup() {
  const t = convexTest(schema, modules);
  const as = (key: string) =>
    t.withIdentity({ tokenIdentifier: `test|${key}`, subject: key, issuer: "test", name: key, email: `${key}@example.com` });
  const owner = as("owner");
  const borrower = as("borrower");
  const admin = as("admin");
  for (const u of [owner, borrower, admin]) await u.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    const row = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", "test|admin")).unique();
    await ctx.db.patch("users", row!._id, { role: "admin" });
  });
  const toolId = await owner.mutation(api.tools.create, {
    name: "Drill", category: "power_tools", condition: "good", description: "18V",
  });
  return { t, owner, borrower, admin, toolId };
}

const edit = { name: "Hacked", category: "garden", condition: "worn", description: "" } as const;
const dates = { startDate: "2026-11-20", endDate: "2026-11-22" };

describe("listings", () => {
  test("public list exposes name and category only", async () => {
    const { t } = await setup();
    const [tool] = await t.query(api.tools.listPublic, {});
    expect(Object.keys(tool).sort()).toEqual(["_id", "category", "name"]);
  });

  test("signed-out callers cannot create a listing", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.tools.create, edit)).rejects.toThrow("Sign in first");
  });

  test("users cannot edit or remove someone else's listing", async () => {
    const { borrower, toolId } = await setup();
    await expect(borrower.mutation(api.tools.update, { toolId, ...edit })).rejects.toThrow("your own listings");
    await expect(borrower.mutation(api.tools.remove, { toolId })).rejects.toThrow("your own listings");
  });

  test("admins can remove any listing but not edit it", async () => {
    const { t, admin, toolId } = await setup();
    await expect(admin.mutation(api.tools.update, { toolId, ...edit })).rejects.toThrow("your own listings");
    await admin.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("loans", () => {
  test("only the tool owner can approve; the borrower cannot approve their own request", async () => {
    const { owner, borrower, admin, toolId } = await setup();
    const loanId = await borrower.mutation(api.loans.request, { toolId, ...dates });
    await expect(borrower.mutation(api.loans.approve, { loanId })).rejects.toThrow("Loan not found");
    await expect(admin.mutation(api.loans.approve, { loanId })).rejects.toThrow("Loan not found");
    await owner.mutation(api.loans.approve, { loanId });
    await expect(owner.mutation(api.loans.approve, { loanId })).rejects.toThrow("Only a pending loan");
  });

  test("owners cannot borrow their own tool", async () => {
    const { owner, toolId } = await setup();
    await expect(owner.mutation(api.loans.request, { toolId, ...dates })).rejects.toThrow("your own tool");
  });

  test("approving overlapping dates is rejected", async () => {
    const { owner, borrower, admin, toolId } = await setup();
    const first = await borrower.mutation(api.loans.request, { toolId, ...dates });
    const second = await admin.mutation(api.loans.request, { toolId, startDate: "2026-11-21", endDate: "2026-11-25" });
    await owner.mutation(api.loans.approve, { loanId: first });
    await expect(owner.mutation(api.loans.approve, { loanId: second })).rejects.toThrow("overlap");
  });

  test("each user only sees their own side of a loan", async () => {
    const { owner, borrower, admin, toolId } = await setup();
    await borrower.mutation(api.loans.request, { toolId, ...dates });
    expect(await borrower.query(api.loans.mine, {})).toHaveLength(1);
    expect(await borrower.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await owner.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await admin.query(api.loans.mine, {})).toHaveLength(0);
  });
});

describe("admin", () => {
  test("only admins can view all loans and mark trusted lenders", async () => {
    const { t, borrower, admin } = await setup();
    await expect(borrower.query(api.loans.all, {})).rejects.toThrow("Admins only");
    const [someone] = await admin.query(api.admin.listUsers, {});
    await expect(borrower.mutation(api.admin.setTrustedLender, { userId: someone._id, trusted: true })).rejects.toThrow("Admins only");
    await admin.mutation(api.admin.setTrustedLender, { userId: someone._id, trusted: true });
    const row = await t.run((ctx) => ctx.db.get("users", someone._id));
    expect(row?.trustedLender).toBe(true);
  });
});
