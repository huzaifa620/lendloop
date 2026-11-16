import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "./MemberShell";

// UX gate only: signed-out visitors are sent home instead of seeing empty
// pages. Every Convex function re-checks identity on its own.
export default function MemberLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <SignedInOnly>{children}</SignedInOnly>
    </Suspense>
  );
}

// Reads the request's session, so it sits inside Suspense (Cache Components).
async function SignedInOnly({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/");
  return <MemberShell>{children}</MemberShell>;
}
