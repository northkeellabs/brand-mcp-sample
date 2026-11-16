import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../../src/index-auth";

const BASE = "http://localhost:8787";
const RESOURCE = `${BASE}/mcp`;
const REDIRECT = "http://127.0.0.1:53682/callback";
const CLIENT_ID = (env as any).GOOGLE_CLIENT_ID as string;

// ---------------------------------------------------------------- mocked Google (token endpoint and signing keys)
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let signKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JsonWebKey & { kid: string };

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const a = await gen();
  const b = await gen();
  signKey = a.privateKey;
  otherKey = b.privateKey;
  jwk = { ...(await crypto.subtle.exportKey("jwk", a.publicKey)), kid: "mock-key-1", alg: "RS256", use: "sig" } as JsonWebKey & { kid: string };
});

async function idToken(claims: Record<string, unknown>, key = signKey): Promise<string> {
  const head = enc({ alg: "RS256", kid: "mock-key-1", typ: "JWT" });
  const body = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

const goodClaims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "1100000000000000001",
  email: "ada@example.test",
  email_verified: true,
  name: "Ada Test",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce,
  ...over,
});

interface GoogleMock {
  tokenCalls: { body: URLSearchParams }[];
}
function mockGoogle(token: () => Promise<Response>): GoogleMock {
  const mock: GoogleMock = { tokenCalls: [] };
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://google.test/certs") return Response.json({ keys: [jwk] });
    if (url === "https://google.test/token") {
      mock.tokenCalls.push({ body: new URLSearchParams(String(init?.body ?? "")) });
      return token();
    }
    return real(input as never, init);
  }) as typeof fetch);
  return mock;
}
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------- helpers: drive the worker like a browser and a client
async function call(req: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const resp = await worker.fetch(req as never, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return resp;
}
const cookies = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function register(): Promise<string> {
  const r = await call(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Test Agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) };
}
const authorizeUrl = (clientId: string, challenge: string, scope = "brand.read") => {
  const u = new URL(`${BASE}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope, state: "client-state", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE })) u.searchParams.set(k, v);
  return u.toString();
}

/** Steps 1-2: client request, consent page, user clicks Continue. Returns the redirect to Google. */
async function startSignIn(decision: "approve" | "deny" = "approve") {
  const clientId = await register();
  const { verifier, challenge } = await pkce();
  const page = await call(new Request(authorizeUrl(clientId, challenge)));
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
  const cookie = cookies(page);
  const post = await call(new Request(`${BASE}/authorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: new URLSearchParams({ handle, decision }), redirect: "manual" }));
  return { clientId, verifier, html, page, post, cookie: cookies(post) || cookie };
}

/** Step 3: Google sends the browser back to /callback. */
const callback = (state: string, cookie: string, extra: Record<string, string> = { code: "google-code" }) => {
  const u = new URL(`${BASE}/callback`);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return call(new Request(u.toString(), { headers: { Cookie: cookie }, redirect: "manual" }));
};

const googleParams = (post: Response) => new URL(post.headers.get("Location")!).searchParams;

async function exchange(clientId: string, verifier: string, location: string) {
  const code = new URL(location).searchParams.get("code")!;
  const r = await call(new Request(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE }) }));
  return (await r.json()) as { access_token?: string };
}

async function mcp(token: string | null, method: string, params: unknown = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", Host: "localhost:8787" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return call(new Request(RESOURCE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
}
async function parseMcp(resp: Response): Promise<any> {
  const text = await resp.text();
  if ((resp.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const d = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    return JSON.parse(d[d.length - 1]);
  }
  return JSON.parse(text);
}

// ================================================================ tests
describe("sign-in: consent and redirect to Google", () => {
  it("shows a consent page naming the client and the redirect host", async () => {
    const { html } = await startSignIn();
    expect(html).toContain("Test Agent");
    expect(html).toContain("127.0.0.1");
    expect(html).toContain("Continue with Google");
  });

  it("approve sends the browser to Google with state, nonce, PKCE and the exact callback URL", async () => {
    const { post } = await startSignIn();
    expect(post.status).toBe(302);
    const loc = new URL(post.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe("https://google.test/auth");
    const p = loc.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    for (const k of ["state", "nonce", "code_challenge"]) expect(p.get(k)!.length).toBeGreaterThan(20);
    expect(post.headers.getSetCookie().some((c) => c.startsWith("__Host-"))).toBe(true);
    expect(loc.toString()).not.toContain("mock-client-secret");
  });

  it("deny goes back to the client with access_denied and the client's state", async () => {
    const { post } = await startSignIn("deny");
    const loc = new URL(post.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("client-state");
  });

  it("an unregistered redirect URI is rejected on the page, not redirected", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const u = new URL(authorizeUrl(clientId, challenge));
    u.searchParams.set("redirect_uri", "https://evil.test/cb");
    const r = await call(new Request(u.toString()));
    expect(r.status).toBe(400);
    expect(r.headers.get("Location")).toBeNull();
  });

  it("POST without a handle is refused", async () => {
    const r = await call(new Request(`${BASE}/authorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ decision: "approve" }) }));
    expect(r.status).toBe(403);
  });
});

describe("sign-in: Google callback", () => {
  it("full flow: Google code -> verified ID token -> grant -> access token -> MCP works", async () => {
    const { clientId, verifier, post, cookie } = await startSignIn();
    const gp = googleParams(post);
    const google = mockGoogle(async () => Response.json({ id_token: await idToken(goodClaims(gp.get("nonce")!)), access_token: "not-used" }));

    const cb = await callback(gp.get("state")!, cookie);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get("Location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("client-state");
    expect(back.searchParams.get("code")).toBeTruthy();

    // the Worker sent Google the code, its own client id and secret, and the PKCE verifier
    expect(google.tokenCalls).toHaveLength(1);
    const sent = google.tokenCalls[0].body;
    expect(sent.get("code")).toBe("google-code");
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(sent.get("client_secret")).toBe("mock-client-secret");
    expect(sent.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(sent.get("code_verifier")!.length).toBeGreaterThan(20);

    const tok = await exchange(clientId, verifier, back.toString());
    expect(tok.access_token).toBeTruthy();

    const list = await parseMcp(await mcp(tok.access_token!, "tools/list"));
    expect(list.result.tools).toHaveLength(5);
    const call1 = await parseMcp(await mcp(tok.access_token!, "tools/call", { name: "check_contrast", arguments: { brand: "tarnbury", foreground: "#000", background: "#fff", text_size: "body" } }));
    expect(call1.result.structuredContent.ratio).toBe(21);
  });

  it("/mcp without a token is 401 with a resource_metadata challenge", async () => {
    const r = await mcp(null, "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

  it("a bad token is 401", async () => {
    expect((await mcp("not-a-real-token", "tools/list")).status).toBe(401);
  });

  it("a state that was never issued is rejected", async () => {
    const { cookie } = await startSignIn();
    mockGoogle(async () => Response.json({}));
    const r = await callback("made-up-state", cookie);
    expect(r.status).toBe(400);
    expect(r.headers.get("Location")).toBeNull();
  });

  it("the right state without this browser's cookie is rejected", async () => {
    const { post } = await startSignIn();
    mockGoogle(async () => Response.json({}));
    const r = await callback(googleParams(post).get("state")!, "");
    expect(r.status).toBe(400);
  });

  it("a state cannot be replayed", async () => {
    const { post, cookie } = await startSignIn();
    const gp = googleParams(post);
    mockGoogle(async () => Response.json({ id_token: await idToken(goodClaims(gp.get("nonce")!)) }));
    expect((await callback(gp.get("state")!, cookie)).status).toBe(302);
    expect((await callback(gp.get("state")!, cookie)).status).toBe(400);
  });

  it("Google reporting an error sends the client access_denied", async () => {
    const { post, cookie } = await startSignIn();
    mockGoogle(async () => Response.json({}));
    const r = await callback(googleParams(post).get("state")!, cookie, { error: "access_denied" });
    expect(new URL(r.headers.get("Location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("Google's token endpoint refusing the code sends the client access_denied", async () => {
    const { post, cookie } = await startSignIn();
    mockGoogle(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const r = await callback(googleParams(post).get("state")!, cookie);
    expect(new URL(r.headers.get("Location")!).searchParams.get("error")).toBe("access_denied");
  });

  const rejected: [string, (nonce: string) => Promise<string>, string][] = [
    ["a token signed by a different key", async (n) => idToken(goodClaims(n), otherKey), "bad signature"],
    ["a token for a different audience", async (n) => idToken(goodClaims(n, { aud: "someone-else" })), "wrong audience"],
    ["a token from a different issuer", async (n) => idToken(goodClaims(n, { iss: "https://evil.test" })), "wrong issuer"],
    ["an expired token", async (n) => idToken(goodClaims(n, { exp: Math.floor(Date.now() / 1000) - 5 })), "expired"],
    ["a token with the wrong nonce", async () => idToken(goodClaims("not-the-nonce")), "nonce mismatch"],
  ];
  it.each(rejected)("rejects %s", async (_name, make, why) => {
    const { post, cookie } = await startSignIn();
    const gp = googleParams(post);
    mockGoogle(async () => Response.json({ id_token: await make(gp.get("nonce")!) }));
    const r = await callback(gp.get("state")!, cookie);
    const loc = new URL(r.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("error_description")).toContain(why);
    expect(loc.searchParams.get("code")).toBeNull();
  });

  it("rejects an unverified Google email", async () => {
    const { post, cookie } = await startSignIn();
    const gp = googleParams(post);
    mockGoogle(async () => Response.json({ id_token: await idToken(goodClaims(gp.get("nonce")!, { email_verified: false })) }));
    const r = await callback(gp.get("state")!, cookie);
    expect(new URL(r.headers.get("Location")!).searchParams.get("error_description")).toContain("not verified");
  });

  it("with ALLOWED_EMAIL_DOMAIN set, only that domain gets in", async () => {
    const e = env as unknown as Record<string, string>;
    e.ALLOWED_EMAIL_DOMAIN = "corp.test";
    try {
      const { post, cookie } = await startSignIn();
      const gp = googleParams(post);
      mockGoogle(async () => Response.json({ id_token: await idToken(goodClaims(gp.get("nonce")!)) })); // ada@example.test
      const r = await callback(gp.get("state")!, cookie);
      expect(new URL(r.headers.get("Location")!).searchParams.get("error_description")).toContain("not allowed");
    } finally {
      delete e.ALLOWED_EMAIL_DOMAIN;
    }
  });
});
