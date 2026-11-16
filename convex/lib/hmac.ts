// HMAC-SHA256 request signing, used in both directions:
//   Convex -> n8n : Convex signs, the n8n workflow verifies.
//   n8n -> Convex : n8n signs, convex/http.ts verifies.
//
// Signed string: `${unixSeconds}.${rawBody}`. Including the timestamp lets the
// receiver reject replays older than MAX_SKEW_SECONDS; signing the raw bytes
// (not re-serialised JSON) means both sides hash exactly the same input.
//
// Uses Web Crypto, which exists in the Convex runtime, Node and n8n alike.

export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function importKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function sign(
  secret: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret, "sign"),
    encoder.encode(`${timestampSeconds}.${body}`),
  );
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signatureHeaders(
  secret: string,
  body: string,
  nowMs = Date.now(),
): Promise<Record<string, string>> {
  const ts = Math.floor(nowMs / 1000);
  return {
    [TIMESTAMP_HEADER]: String(ts),
    [SIGNATURE_HEADER]: `sha256=${await sign(secret, ts, body)}`,
  };
}

// Fail closed: any missing or malformed input is a rejection, never a pass.
export async function verify(
  secret: string | undefined,
  timestampHeader: string | null,
  signatureHeader: string | null,
  body: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) return false;

  const match = /^sha256=([0-9a-f]{64})$/.exec(signatureHeader);
  if (!match) return false;
  const provided = new Uint8Array(match[1].match(/../g)!.map((h) => parseInt(h, 16)));

  // subtle.verify compares in constant time, so a byte-by-byte timing attack
  // on the signature learns nothing.
  return crypto.subtle.verify(
    "HMAC",
    await importKey(secret, "verify"),
    provided,
    encoder.encode(`${ts}.${body}`),
  );
}
