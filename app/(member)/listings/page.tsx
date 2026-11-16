"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Badge, CATEGORIES, CONDITIONS, Empty, ErrorText, useRun } from "@/components/ui";

type Tool = FunctionReturnType<typeof api.tools.mine>[number];
type Fields = { name: string; category: Tool["category"]; condition: Tool["condition"]; description: string };

export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3">
        <h1 className="text-lg font-semibold">List a tool</h1>
        <ToolForm submitLabel="Add listing" onSubmit={(fields) => create(fields)} resetOnSuccess />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My listings</h2>
        {tools === undefined ? (
          <Empty>Loading…</Empty>
        ) : tools.length === 0 ? (
          <Empty>You haven&apos;t listed anything yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {tools.map((tool) => <Listing key={tool._id} tool={tool} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Listing({ tool }: { tool: Tool }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const { run, error, busy } = useRun();

  if (editing) {
    return (
      <li className="card">
        <ToolForm
          initial={tool}
          submitLabel="Save"
          onSubmit={async (fields) => {
            await update({ toolId: tool._id, ...fields });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{tool.name}</div>
          <div className="text-sm text-muted">{CATEGORIES[tool.category]} · {CONDITIONS[tool.condition]} condition</div>
        </div>
        {tool.available ? <Badge tone="accent">Available</Badge> : <Badge>On loan until {tool.dueBack}</Badge>}
      </div>
      {tool.description && <p className="text-sm">{tool.description}</p>}
      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="btn text-danger"
          disabled={busy}
          onClick={() => confirm(`Remove "${tool.name}"? Pending requests will be declined.`) && run(() => remove({ toolId: tool._id }))}
        >
          Remove
        </button>
        <ErrorText error={error} />
      </div>
    </li>
  );
}

function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess,
}: {
  initial?: Fields;
  submitLabel: string;
  onSubmit: (fields: Fields) => Promise<unknown>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}) {
  const { run, error, busy } = useRun();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const form = new FormData(formEl);
        const ok = await run(() =>
          onSubmit({
            name: String(form.get("name")),
            category: form.get("category") as Fields["category"],
            condition: form.get("condition") as Fields["condition"],
            description: String(form.get("description")),
          }),
        );
        if (ok && resetOnSuccess) formEl.reset();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input className="input" name="name" required maxLength={80} defaultValue={initial?.name} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Category
        <select className="input" name="category" defaultValue={initial?.category ?? "power_tools"}>
          {Object.entries(CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Condition
        <select className="input" name="condition" defaultValue={initial?.condition ?? "good"}>
          {Object.entries(CONDITIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Short description
        <textarea className="input" name="description" rows={2} maxLength={500} defaultValue={initial?.description} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <ErrorText error={error} />
      </div>
    </form>
  );
}
