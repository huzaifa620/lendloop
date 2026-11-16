"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge, CATEGORIES, CONDITIONS, Empty, ErrorText, useRun, type Category } from "@/components/ui";

export default function ToolsPage() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const me = useQuery(api.users.me);
  const remove = useMutation(api.tools.remove);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">All tools</h1>
        <label className="flex items-center gap-2 text-sm">
          Category
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">All</option>
            {Object.entries(CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {tools === undefined ? (
        <Empty>Loading…</Empty>
      ) : tools.length === 0 ? (
        <Empty>Nothing listed in this category yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {tools.map((tool) => (
            <li key={tool._id} className="card flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{tool.name}</div>
                  <div className="text-sm text-muted">
                    {CATEGORIES[tool.category]} · {CONDITIONS[tool.condition]} condition · lent by{" "}
                    {tool.isMine ? "you" : tool.ownerName}
                  </div>
                </div>
                <div className="flex gap-2">
                  {tool.ownerTrusted && <Badge tone="accent">Trusted Lender</Badge>}
                  {tool.available ? <Badge tone="accent">Available</Badge> : <Badge>On loan until {tool.dueBack}</Badge>}
                </div>
              </div>
              {tool.description && <p className="text-sm">{tool.description}</p>}
              <div className="flex flex-wrap items-end justify-between gap-3">
                {!tool.isMine && <BorrowForm toolId={tool._id} />}
                {me?.role === "admin" && (
                  <AdminRemove onRemove={() => remove({ toolId: tool._id })} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BorrowForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const { run, error, busy } = useRun();
  const [sent, setSent] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (sent) return <p className="text-sm text-accent">Request sent. Track it under My requests.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const ok = await run(() =>
          request({ toolId, startDate: String(form.get("start")), endDate: String(form.get("end")) }),
        );
        if (ok) setSent(true);
      }}
    >
      <label className="flex flex-col text-xs text-muted">
        From
        <input className="input" type="date" name="start" min={today} required />
      </label>
      <label className="flex flex-col text-xs text-muted">
        To
        <input className="input" type="date" name="end" min={today} required />
      </label>
      <button className="btn-primary" disabled={busy}>Request to borrow</button>
      <ErrorText error={error} />
    </form>
  );
}

function AdminRemove({ onRemove }: { onRemove: () => Promise<unknown> }) {
  const { run, error, busy } = useRun();
  return (
    <div className="flex items-center gap-2">
      <ErrorText error={error} />
      <button
        className="btn text-danger"
        disabled={busy}
        onClick={() => confirm("Remove this listing for everyone?") && run(onRemove)}
      >
        Remove listing (admin)
      </button>
    </div>
  );
}
