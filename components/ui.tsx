"use client";

import { ConvexError } from "convex/values";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export const CATEGORIES = {
  power_tools: "Power tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  other: "Other",
} as const;
export type Category = keyof typeof CATEGORIES;

export const CONDITIONS = { new: "New", good: "Good", fair: "Fair", worn: "Worn" } as const;

// Runs a mutation and keeps its error message for display. Server-side
// ConvexErrors carry a message meant for users; anything else stays generic.
export function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm text-danger">{error}</p> : null;
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "danger" }) {
  const color = { muted: "text-muted border-line", accent: "text-accent border-accent/40", danger: "text-danger border-danger/40" }[tone];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}>{children}</span>;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((ms - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

type Loan = FunctionReturnType<typeof api.loans.mine>[number];

const STATUS_TONE = { pending: "muted", approved: "accent", declined: "danger", returned: "muted" } as const;

const ACTIVITY_LABEL = {
  notification: "Notification",
  reminder: "Reminder",
  webhook_delivery: "Webhook delivery",
} as const;

// One loan row, shared by "My requests", "Incoming" and the admin view.
export function LoanRow({ loan, who, children }: { loan: Loan; who: string; children?: React.ReactNode }) {
  return (
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{loan.toolName}</span>
          <span className="text-sm text-muted"> · {who} · {loan.startDate} → {loan.endDate}</span>
        </div>
        <div className="flex items-center gap-2">
          {loan.overdue && <Badge tone="danger">Overdue</Badge>}
          <Badge tone={STATUS_TONE[loan.status]}>{loan.status}</Badge>
        </div>
      </div>
      {loan.activity.length > 0 && (
        <ul className="text-xs text-muted">
          {loan.activity.map((a) => (
            <li key={`${a.kind}-${a.at}`}>
              {ACTIVITY_LABEL[a.kind]} {a.status} {timeAgo(a.at)}
            </li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
