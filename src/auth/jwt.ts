// Verifies a Google ID token (RS256) against Google's published signing keys, using WebCrypto only.

export interface IdClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  hd?: string;
}

export class IdTokenError extends Error {}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
  } catch {
    throw new IdTokenError("malformed token");
  }
}

export interface VerifyOptions {
  jwksUrl: string;
  clientId: string;
  nonce: string;
  /** Unix seconds; injectable for tests. */
  now?: number;
}

/** Throws IdTokenError unless the token is a valid, unexpired Google ID token for this client and nonce. */
export async function verifyIdToken(token: string, opts: VerifyOptions): Promise<IdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdTokenError("malformed token");
  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== "RS256" || !header.kid) throw new IdTokenError("unsupported algorithm");

  const resp = await fetch(opts.jwksUrl);
  if (!resp.ok) throw new IdTokenError("could not load Google signing keys");
  const jwks = (await resp.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const jwk = jwks.keys?.find((k) => k.kid === header.kid);
  if (!jwk) throw new IdTokenError("unknown signing key");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new IdTokenError("bad signature");

  const c = decodeJson<IdClaims>(parts[1]);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(c.iss)) throw new IdTokenError("wrong issuer");
  if (c.aud !== opts.clientId) throw new IdTokenError("wrong audience");
  if (typeof c.exp !== "number" || c.exp <= now) throw new IdTokenError("token expired");
  if (!c.nonce || c.nonce !== opts.nonce) throw new IdTokenError("nonce mismatch");
  if (!c.sub) throw new IdTokenError("no subject");
  return c;
}
