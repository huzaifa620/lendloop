"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, Empty } from "@/components/ui";

export default function Home() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 py-6">
        <h1 className="text-4xl font-semibold tracking-tight">LendLoop</h1>
        <p className="text-xl text-muted">Borrow what you need. Lend what you don&apos;t.</p>
        <div>
          <Unauthenticated>
            <SignInButton mode="modal">
              <button className="btn-primary">Sign in to lend or borrow</button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <Link href="/tools" className="btn-primary inline-block">Browse and borrow</Link>
          </Authenticated>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Available in the loop</h2>
        {tools === undefined ? (
          <Empty>Loading…</Empty>
        ) : tools.length === 0 ? (
          <Empty>No tools listed yet.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tools.map((t) => (
              <li key={t._id} className="card flex items-center justify-between">
                <span>{t.name}</span>
                <span className="text-sm text-muted">{CATEGORIES[t.category]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
