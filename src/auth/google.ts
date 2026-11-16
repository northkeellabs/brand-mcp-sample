// "Sign in with Google" in front of the server's own OAuth 2.1 layer.
//
// The MCP client talks OAuth 2.1 to this Worker (@cloudflare/workers-oauth-provider is the authorization
// server). The Worker in turn is an OpenID Connect client of Google:
//   GET  /authorize   validate the client's request, show a consent page for this client
//   POST /authorize   user approves -> redirect to Google (state + binding cookie, PKCE, nonce)
//   GET  /callback    Google redirects back -> exchange the code, verify the ID token -> completeAuthorization
// The Google client id and secret come from environment bindings only; nothing is stored in a file.

import { AuthorizationError, CimdFetchError, authorizationErrorRedirect, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { IdTokenError, verifyIdToken } from "./jwt";

export const SCOPE_READ = "brand.read";

export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Canonical URL of the MCP endpoint; every token is bound to it. */
  MCP_RESOURCE: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Optional: only accept Google accounts of this domain, e.g. example.com. */
  ALLOWED_EMAIL_DOMAIN?: string;
  /** Endpoint overrides. Default to Google's; tests point them at mocks. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_JWKS_URL?: string;
}

export interface GrantProps {
  sub: string;
  email: string;
  name?: string;
}

interface UpstreamData {
  verifier: string;
  nonce: string;
}

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function pageHeaders(base?: Headers): Headers {
  const h = new Headers(base);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.append("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store");
  return h;
}

const STYLE = "body{font:16px/1.5 system-ui,sans-serif;max-width:38rem;margin:2rem auto;padding:0 1rem}.box{border:1px solid #999;padding:.8rem 1rem;margin:1rem 0}.err{border-color:#b00}button{font:inherit;padding:.5rem 1.2rem;margin-right:.6rem}code{word-break:break-all}";

function page(title: string, body: string, status = 200, base?: Headers): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`, {
    status,
    headers: pageHeaders(base),
  });
}

export const errorPage = (message: string, status = 400) => page("Sign-in error", `<h1>Sign-in could not continue</h1><div class="box err"><p>${esc(message)}</p></div>`, status);

function oauthError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectUri) {
    return new Response(null, { status: 302, headers: { Location: authorizationErrorRedirect({ redirectUri: error.redirectUri, state: error.state }, error.code, error.description) } });
  }
  if (error instanceof AuthorizationError) return errorPage(error.description || "Invalid authorization request.");
  if (error instanceof CimdFetchError) return errorPage("This app could not be verified.");
  throw error;
}

async function handleAuthorize(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const authReq = await oauth.parseAuthRequest(request); // rejects unknown clients and unregistered redirect URIs
      const d = await oauth.describeConsent(authReq);
      const consent = await oauth.beginConsent(authReq);
      const origin = d.clientDomain ? `Published by <strong>${esc(d.clientDomain)}</strong>.` : "This app registered itself; its name is not verified.";
      const loop = d.redirectIsLoopback ? `<div class="box"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</div>` : "";
      const body = `<h1>Connect ${esc(d.clientName)} to the brand server?</h1>
<div class="box"><p><strong>${esc(d.clientName)}</strong> is asking to read brand tokens and rules from this server (read-only). ${origin}</p>
<p>Access will be sent to <strong>${esc(d.redirectHost)}</strong><br><small>Redirect URI: <code>${esc(d.redirectUri)}</code></small></p></div>${loop}
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${esc(consent.handle)}">
<p>You will be asked to sign in with Google. Only your Google account id and email are used, to identify the connection.</p>
<p><button type="submit" name="decision" value="approve">Continue with Google</button><button type="submit" name="decision" value="deny">Deny</button></p></form>`;
      return page(`Authorize ${d.clientName}`, body, 200, consent.headers);
    }
    if (request.method !== "POST") return errorPage("Method not allowed.", 405);

    const ct = request.headers.get("Content-Type") || "";
    if (!ct.startsWith("application/x-www-form-urlencoded") && !ct.startsWith("multipart/form-data")) return errorPage("Expected a form submission.");
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (!handle) return errorPage("Missing or invalid CSRF token. Start connecting again from your app.", 403);

    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      denied.headers.set("Location", denied.redirectTo);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return errorPage("Google sign-in is not configured on this server.", 500);

    const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE_READ] });
    const verifier = random(32);
    const nonce = random(16);
    const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier, nonce } satisfies UpstreamData, headers: approved.headers });

    const g = new URL(env.GOOGLE_AUTH_URL || GOOGLE_AUTH);
    g.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    g.searchParams.set("redirect_uri", new URL("/callback", request.url).toString());
    g.searchParams.set("response_type", "code");
    g.searchParams.set("scope", "openid email profile");
    g.searchParams.set("state", state);
    g.searchParams.set("nonce", nonce);
    g.searchParams.set("code_challenge", b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    g.searchParams.set("code_challenge_method", "S256");
    g.searchParams.set("prompt", "select_account");
    headers.set("Location", g.toString());
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return oauthError(e);
  }
}

async function handleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  let resumed;
  try {
    resumed = await env.OAUTH_PROVIDER.finishUpstream<UpstreamData>(request); // checks state, binding cookie, single use
  } catch (e) {
    return oauthError(e);
  }
  const { request: authReq, data, headers } = resumed;
  const fail = (message: string) => errorPage(message, 400);
  const back = (code: "access_denied" | "server_error", description: string) => {
    headers.set("Location", authorizationErrorRedirect(authReq, code, description));
    return new Response(null, { status: 302, headers });
  };

  if (url.searchParams.get("error")) return back("access_denied", "Google sign-in was cancelled or refused");
  const code = url.searchParams.get("code");
  if (!code) return fail("Google did not return a sign-in code.");

  let tokenResp: Response;
  try {
    tokenResp = await fetch(env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: new URL("/callback", request.url).toString(),
        code_verifier: data.verifier,
      }),
    });
  } catch {
    return back("server_error", "Could not reach Google");
  }
  if (!tokenResp.ok) return back("access_denied", "Google refused the sign-in code");
  const tokens = (await tokenResp.json().catch(() => ({}))) as { id_token?: string };
  if (!tokens.id_token) return back("server_error", "Google returned no ID token");

  let claims;
  try {
    claims = await verifyIdToken(tokens.id_token, { jwksUrl: env.GOOGLE_JWKS_URL || GOOGLE_JWKS, clientId: env.GOOGLE_CLIENT_ID, nonce: data.nonce });
  } catch (e) {
    return back("access_denied", e instanceof IdTokenError ? `Google ID token rejected: ${e.message}` : "Google ID token rejected");
  }
  if (!claims.email || claims.email_verified !== true) return back("access_denied", "Your Google email is not verified");
  const domain = env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (domain && !claims.email.toLowerCase().endsWith("@" + domain)) return back("access_denied", "This Google account is not allowed on this server");

  const props: GrantProps = { sub: claims.sub, email: claims.email, name: claims.name };
  try {
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({ request: authReq, userId: claims.sub, metadata: { email: claims.email }, scope: [SCOPE_READ], props });
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return oauthError(e);
  }
}

export const googleHandler: ExportedHandler<AuthEnv> = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/callback" && request.method === "GET") return handleCallback(request, env);
    if (pathname === "/" && request.method === "GET") {
      return page("Brand MCP server (sample)", `<h1>Brand MCP server (sample)</h1><p>Invented brands, read-only. Connect an MCP client to <code>${esc(env.MCP_RESOURCE)}</code>.</p>`);
    }
    return new Response("Not found", { status: 404 });
  },
};
