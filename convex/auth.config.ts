import { AuthConfig } from "convex/server";

// Convex verifies the Clerk-issued JWT itself (signature, issuer, audience)
// before any function sees ctx.auth. Set CLERK_JWT_ISSUER_DOMAIN on the Convex
// deployment: `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev`
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
