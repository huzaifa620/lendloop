"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge, Empty, ErrorText, LoanRow, useRun } from "@/components/ui";

// Hidden from the nav for non-admins, but the queries below throw
// "Admins only" on the server for anyone else who opens this URL.
export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me === undefined) return <Empty>Loading…</Empty>;
  if (me?.role !== "admin") return <Empty>This page is for admins.</Empty>;
  return (
    <div className="flex flex-col gap-8">
      <Users />
      <AllLoans />
    </div>
  );
}

function Users() {
  const users = useQuery(api.admin.listUsers);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { run, error, busy } = useRun();
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Members</h1>
      <ErrorText error={error} />
      {users === undefined ? (
        <Empty>Loading…</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
          {users.map((u) => (
            <li key={u._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{u.name}</span>
                <span className="text-sm text-muted">{u.email}</span>
                {u.role === "admin" && <Badge>admin</Badge>}
                {u.trustedLender && <Badge tone="accent">Trusted Lender</Badge>}
              </div>
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}
              >
                {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AllLoans() {
  const loans = useQuery(api.loans.all);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">All loans</h2>
      {loans === undefined ? (
        <Empty>Loading…</Empty>
      ) : loans.length === 0 ? (
        <Empty>No loans yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <LoanRow key={loan._id} loan={loan} who={`${loan.lenderName} → ${loan.otherPartyName}`} />
          ))}
        </ul>
      )}
    </section>
  );
}
