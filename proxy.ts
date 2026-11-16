import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session readable in server components. Page-level gating is
// in app/(member)/layout.tsx; the real access control is in the Convex functions.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
