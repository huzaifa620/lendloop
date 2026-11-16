"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Empty, LoanRow } from "@/components/ui";

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.mine);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">My requests</h1>
      {loans === undefined ? (
        <Empty>Loading…</Empty>
      ) : loans.length === 0 ? (
        <Empty>You haven&apos;t asked to borrow anything yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => <LoanRow key={loan._id} loan={loan} who={`from ${loan.otherPartyName}`} />)}
        </ul>
      )}
    </div>
  );
}
