"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Empty } from "@/components/ui";

const TABS = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

export default function MemberShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  const me = useQuery(api.users.me, stored ? {} : "skip");
  const pathname = usePathname();

  // Create/refresh the Convex user row from the verified Clerk token before
  // rendering anything that needs it.
  useEffect(() => {
    if (!isAuthenticated) return;
    storeUser().then(() => setStored(true));
  }, [isAuthenticated, storeUser]);

  if (!stored) return <Empty>Signing you in…</Empty>;

  const tabs = me?.role === "admin" ? [...TABS, { href: "/admin", label: "Admin" }] : TABS;
  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Sections">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={pathname === t.href ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              pathname === t.href ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
