import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same Web APIs as the Convex runtime (fetch, crypto.subtle, no Node built-ins).
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
