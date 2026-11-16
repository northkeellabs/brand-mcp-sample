// SAMPLE brand MCP server (invented brands). One Cloudflare Worker, one /mcp endpoint, stateless streamable HTTP, read-only.
// Pattern copied from the lacrm-mcp-remote reference: createMcpHandler builds a fresh McpServer per request.

import { createMcpHandler } from "agents/mcp/server";
import { buildServer } from "./tools";

const mcp = createMcpHandler(() => buildServer(), { route: "/mcp" });

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return mcp(request, env as never, ctx);
    return new Response("Not found. The MCP endpoint is /mcp.", { status: 404 });
  },
};
