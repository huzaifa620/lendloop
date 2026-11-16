/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, signatureHeaders, verify } from "./lib/hmac";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret-not-real";
const NOW = Date.parse("2026-11-16T12:00:00Z");

beforeEach(() => {
  vi.stubEnv("LENDLOOP_WEBHOOK_SECRET", SECRET);
});

describe("HMAC verify", () => {
  const body = '{"hello":"world"}';

  test("accepts a correctly signed body", async () => {
    const h = await signatureHeaders(SECRET, body, NOW);
    expect(await verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, NOW)).toBe(true);
  });

  test("rejects a tampered body, a wrong secret, and a missing secret", async () => {
    const h = await signatureHeaders(SECRET, body, NOW);
    expect(await verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], '{"hello":"w0rld"}', NOW)).toBe(false);
    expect(await verify("other-secret", h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, NOW)).toBe(false);
    expect(await verify(undefined, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, NOW)).toBe(false);
  });

  test("rejects replays outside the 5 minute window, in both directions", async () => {
    const h = await signatureHeaders(SECRET, body, NOW);
    expect(await verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, NOW + 301_000)).toBe(false);
    expect(await verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, NOW - 301_000)).toBe(false);
  });

  test("rejects malformed headers instead of guessing", async () => {
    const ts = String(NOW / 1000);
    const hex = await sign(SECRET, NOW / 1000, body);
    expect(await verify(SECRET, ts, hex, body, NOW)).toBe(false); // missing "sha256=" prefix
    expect(await verify(SECRET, "abc", `sha256=${hex}`, body, NOW)).toBe(false);
    expect(await verify(SECRET, null, `sha256=${hex}`, body, NOW)).toBe(false);
  });

  test("signing the timestamp means a signature can't be moved to a new timestamp", async () => {
    const hex = await sign(SECRET, NOW / 1000, body);
    expect(await verify(SECRET, String(NOW / 1000 + 60), `sha256=${hex}`, body, NOW)).toBe(false);
  });
});

async function seedOverdueLoan(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const user = (k: string) =>
      ctx.db.insert("users", { tokenIdentifier: `t|${k}`, name: k, email: `${k}@example.com`, role: "user", trustedLender: false });
    const ownerId = await user("owner");
    const borrowerId = await user("borrower");
    const toolId = await ctx.db.insert("tools", { ownerId, name: "Drill", category: "power_tools", condition: "good", description: "" });
    return ctx.db.insert("loans", { toolId, ownerId, borrowerId, startDate: "2026-11-01", endDate: "2026-11-10", status: "approved" });
  });
}

async function signedFetch(t: ReturnType<typeof convexTest>, path: string, payload?: object) {
  const body = payload ? JSON.stringify(payload) : "";
  return t.fetch(path, {
    method: payload ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(await signatureHeaders(SECRET, body)) },
    body: payload ? body : undefined,
  });
}

describe("n8n write-back endpoint", () => {
  test("rejects unsigned and wrongly signed requests", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const body = JSON.stringify({ key: "k", loanId, kind: "reminder", status: "sent" });
    expect((await t.fetch("/automation/activity", { method: "POST", body })).status).toBe(401);
    const forged = await signatureHeaders("wrong-secret", body);
    expect((await t.fetch("/automation/activity", { method: "POST", body, headers: forged })).status).toBe(401);
    expect((await t.fetch("/automation/overdue-loans", { method: "GET" })).status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toHaveLength(0);
  });

  test("a retried write-back never creates a second record", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const payload = { key: `reminder:${loanId}:2026-11-16`, loanId, kind: "reminder", status: "sent" };

    const first = await signedFetch(t, "/automation/activity", payload);
    const retry = await signedFetch(t, "/automation/activity", payload);
    expect(await first.json()).toEqual({ result: "created" });
    expect(await retry.json()).toEqual({ result: "duplicate" });
    expect(retry.status).toBe(200); // a duplicate is success, so n8n stops retrying
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toHaveLength(1);
  });

  test("failed -> sent upgrades the record; a late failed never downgrades sent", async () => {
    const t = convexTest(schema, modules);
    const loanId = await seedOverdueLoan(t);
    const base = { key: "notification:x", loanId, kind: "notification" };
    await signedFetch(t, "/automation/activity", { ...base, status: "failed" });
    expect(await (await signedFetch(t, "/automation/activity", { ...base, status: "sent" })).json()).toEqual({ result: "updated" });
    expect(await (await signedFetch(t, "/automation/activity", { ...base, status: "failed" })).json()).toEqual({ result: "duplicate" });
    const rows = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(rows.map((r) => r.status)).toEqual(["sent"]);
  });

  test("rejects unknown loans and malformed bodies after verifying the signature", async () => {
    const t = convexTest(schema, modules);
    await seedOverdueLoan(t);
    expect((await signedFetch(t, "/automation/activity", { key: "k", loanId: "nope", kind: "reminder", status: "sent" })).status).toBe(404);
    expect((await signedFetch(t, "/automation/activity", { key: "k", loanId: "x", kind: "delete_everything", status: "sent" })).status).toBe(400);
  });
});

describe("overdue endpoint", () => {
  test("returns minimal fields and skips loans already reminded today", async () => {
    const t = convexTest(schema, modules);
    const loanId: Id<"loans"> = await seedOverdueLoan(t);

    const before = await (await signedFetch(t, "/automation/overdue-loans")).json();
    expect(before.loans).toHaveLength(1);
    const [loan] = before.loans;
    expect(Object.keys(loan.borrower).sort()).toEqual(["email", "name"]);
    expect(loan).not.toHaveProperty("ownerId");

    await signedFetch(t, "/automation/activity", { key: loan.reminderKey, loanId, kind: "reminder", status: "sent" });
    const after = await (await signedFetch(t, "/automation/overdue-loans")).json();
    expect(after.loans).toHaveLength(0);
  });
});
