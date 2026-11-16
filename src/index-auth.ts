// Same MCP server as src/index.ts, but behind OAuth 2.1 with Google sign-in. This is the optional "auth" entry point.
// @cloudflare/workers-oauth-provider is the authorization server and resource-server gate for /mcp;
// Google is the upstream identity provider (src/auth/google.ts). Not deployed from this sample.

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { googleHandler, SCOPE_READ, type AuthEnv } from "./auth/google";
import { buildServer } from "./tools";

const mcp = createMcpHandler(() => buildServer(), { route: "/mcp" });

export default new OAuthProvider<AuthEnv>({
  apiRoute: "/mcp",
  apiHandler: { fetch: (request, e, ctx) => mcp(request, e as never, ctx) },
  defaultHandler: googleHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [SCOPE_READ],
  requiredScopes: [SCOPE_READ],
  resourceMetadata: { resource: (env as unknown as AuthEnv).MCP_RESOURCE, resource_name: "Brand MCP server (sample, invented brands)" },
  accessTokenTTL: 3600,
});
