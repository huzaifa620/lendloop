// HTTP endpoints called by n8n. Each request must carry a valid HMAC
// signature; the body is only parsed after the signature checks out.
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { todayUtc } from "./lib/access";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function readVerified(req: Request): Promise<string | null> {
  const body = await req.text();
  const ok = await verify(
    process.env.LENDLOOP_WEBHOOK_SECRET,
    req.headers.get(TIMESTAMP_HEADER),
    req.headers.get(SIGNATURE_HEADER),
    body,
  );
  return ok ? body : null;
}

const http = httpRouter();

// Daily reminder workflow: list loans that need a reminder today.
http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if ((await readVerified(req)) === null) return json({ error: "invalid signature" }, 401);
    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json({ asOf: today, loans });
  }),
});

const KINDS = ["notification", "reminder"] as const; // webhook_delivery is Convex-internal
const STATUSES = ["sent", "failed"] as const;

// Both workflows write back here: "notification sent" and "reminder sent/failed".
http.route({
  path: "/automation/activity",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await readVerified(req);
    if (body === null) return json({ error: "invalid signature" }, 401);

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const { key, loanId, kind, status } = input;
    if (
      typeof key !== "string" || key.length === 0 || key.length > 200 ||
      typeof loanId !== "string" || loanId.length > 64 ||
      !KINDS.includes(kind as (typeof KINDS)[number]) ||
      !STATUSES.includes(status as (typeof STATUSES)[number])
    ) {
      return json({ error: "expected { key, loanId, kind: notification|reminder, status: sent|failed }" }, 400);
    }

    const result = await ctx.runMutation(internal.automation.recordActivity, {
      key,
      loanId,
      kind: kind as (typeof KINDS)[number],
      status: status as (typeof STATUSES)[number],
    });
    if (result === "unknown_loan") return json({ error: "unknown loan" }, 404);
    // 200 for duplicates too: the caller's goal ("this is recorded") is met,
    // so n8n must not treat a retry as a failure.
    return json({ result });
  }),
});

export default http;
