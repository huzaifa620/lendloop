#!/usr/bin/env node
// One-command wiring of Convex <-> n8n for local development:
//
//   docker compose up -d && npm run setup:automation
//
// 1. Generates a fresh 256-bit HMAC secret (or uses LENDLOOP_WEBHOOK_SECRET if set).
// 2. Stores it on the Convex deployment as an environment variable.
// 3. Stores it in n8n as an encrypted "Crypto" credential.
// 4. Imports the workflows from n8n/workflows and publishes them.
//
// The secret is never printed and never written inside the repo. Re-running
// the script rotates it on both sides at once.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const N8N_WEBHOOK_URL =
  process.env.N8N_NOTIFY_WEBHOOK_URL ?? "http://localhost:5678/webhook/lendloop-loan-events";
const CREDENTIAL = { id: "LLhmacCredent001", name: "LendLoop HMAC secret", type: "crypto" };
// n8n 2.x only runs an error workflow if it is published too.
const PUBLISH = ["LLloanEvents0001", "LLoverdueRemind1", "LLerrorHandler01"];

function run(cmd, args, input) {
  // npx is a .cmd shim on Windows and needs a shell; docker must not get one,
  // or cmd.exe mangles the quoted `sh -c` argument.
  const shell = process.platform === "win32" && cmd === "npx";
  const res = spawnSync(cmd, args, { input, shell, encoding: "utf8" });
  if (res.status !== 0) {
    // Don't echo the command line: it may contain the secret.
    console.error(`✖ ${cmd} ${args[0]} ${args[1] ?? ""} failed:\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
  return res.stdout;
}

const secret = process.env.LENDLOOP_WEBHOOK_SECRET ?? randomBytes(32).toString("hex");
if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) {
  console.error("✖ LENDLOOP_WEBHOOK_SECRET must be 32+ characters of [A-Za-z0-9_-]");
  process.exit(1);
}

console.log("→ Setting Convex environment variables");
run("npx", ["convex", "env", "set", "LENDLOOP_WEBHOOK_SECRET", secret]);
run("npx", ["convex", "env", "set", "N8N_NOTIFY_WEBHOOK_URL", N8N_WEBHOOK_URL]);

console.log("→ Creating the n8n credential (encrypted at rest by n8n)");
const credentials = JSON.stringify([{ ...CREDENTIAL, data: { hmacSecret: secret } }]);
// Piped over stdin into a temp file inside the container, imported, then deleted.
run("docker", ["compose", "exec", "-T", "n8n", "sh", "-c",
  "umask 077 && cat > /tmp/ll-cred.json && n8n import:credentials --input=/tmp/ll-cred.json; s=$?; rm -f /tmp/ll-cred.json; exit $s"],
  credentials);

console.log("→ Importing and publishing workflows");
run("docker", ["compose", "exec", "-T", "n8n", "n8n", "import:workflow", "--separate", "--input=/workflows"]);
for (const id of PUBLISH) run("docker", ["compose", "exec", "-T", "n8n", "n8n", "publish:workflow", `--id=${id}`]);

// Workflows published from the CLI register their webhooks on restart.
run("docker", ["compose", "restart", "n8n"]);
console.log(`✔ Done. Convex will POST loan events to ${N8N_WEBHOOK_URL}`);
