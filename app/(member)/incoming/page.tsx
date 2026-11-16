"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Empty, ErrorText, LoanRow, useRun } from "@/components/ui";

export default function IncomingPage() {
  const loans = useQuery(api.loans.incoming);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Incoming requests</h1>
      {loans === undefined ? (
        <Empty>Loading…</Empty>
      ) : loans.length === 0 ? (
        <Empty>No one has asked to borrow your tools yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <LoanRow key={loan._id} loan={loan} who={`for ${loan.otherPartyName}`}>
              <Actions loanId={loan._id} status={loan.status} />
            </LoanRow>
          ))}
        </ul>
      )}
    </div>
  );
}

function Actions({ loanId, status }: { loanId: Id<"loans">; status: string }) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, error, busy } = useRun();

  if (status !== "pending" && status !== "approved") return null;
  return (
    <div className="flex items-center gap-2">
      {status === "pending" && (
        <>
          <button className="btn-primary" disabled={busy} onClick={() => run(() => approve({ loanId }))}>Approve</button>
          <button className="btn" disabled={busy} onClick={() => run(() => decline({ loanId }))}>Decline</button>
        </>
      )}
      {status === "approved" && (
        <button className="btn" disabled={busy} onClick={() => run(() => markReturned({ loanId }))}>Mark returned</button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
