import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../src/index";

async function raw(body: unknown, path = "/mcp", method = "POST"): Promise<Response> {
  const ctx = createExecutionContext();
  const resp = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Host: "localhost:8787" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return resp;
}

async function rpc(method: string, params?: unknown): Promise<any> {
  const resp = await raw({ jsonrpc: "2.0", id: 1, method, params });
  const text = await resp.text();
  if ((resp.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

async function tool(name: string, args: Record<string, unknown>) {
  const r = await rpc("tools/call", { name, arguments: args });
  return r.result ?? r.error;
}

describe("server surface", () => {
  it("initialize reports the server name and read-only instructions", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(r.result.serverInfo.name).toBe("brand-mcp-sample");
    expect(r.result.instructions).toContain("Read-only");
  });

  it("lists exactly 5 tools, each read-only, each requiring a brand enum", async () => {
    const r = await rpc("tools/list");
    const tools = r.result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(["check_contrast", "get_color_rules", "get_format", "get_tokens", "search_brand"]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.inputSchema.required).toContain("brand");
      expect(t.inputSchema.properties.brand.enum).toEqual(["tarnbury", "pellmoor"]);
      expect(t.description.length).toBeGreaterThan(80);
    }
  });

  it("lists 4 brand:// resources and 1 prompt", async () => {
    const res = await rpc("resources/list");
    expect(res.result.resources.map((x: any) => x.uri).sort()).toEqual([
      "brand://pellmoor/rules",
      "brand://pellmoor/tokens",
      "brand://tarnbury/rules",
      "brand://tarnbury/tokens",
    ]);
    const pr = await rpc("prompts/list");
    expect(pr.result.prompts.map((p: any) => p.name)).toEqual(["review_colors"]);
  });

  it("serves only /mcp: other paths are 404", async () => {
    const resp = await raw({}, "/", "GET");
    expect(resp.status).toBe(404);
  });
});

describe("get_tokens", () => {
  it("dtcg: returns the DTCG subtree with aliases kept", async () => {
    const r = await tool("get_tokens", { brand: "tarnbury", category: "color" });
    expect(r.structuredContent.format).toBe("dtcg");
    expect(r.structuredContent.dtcg.color.role.primary.$value).toBe("{color.palette.heather}");
    expect(r.structuredContent.dtcg.color.palette.heather.$value).toMatchObject({ colorSpace: "srgb", hex: "#6a2c5b" });
  });
  it("css: returns custom properties scoped to the brand", async () => {
    const r = await tool("get_tokens", { brand: "pellmoor", category: "color", format: "css" });
    expect(r.structuredContent.css).toContain('[data-brand="pellmoor"]');
    expect(r.structuredContent.css).toContain("--color-role-primary: #2d5b4e;");
    expect(r.structuredContent.css).not.toContain("--font-");
    expect(r.structuredContent.token_count).toBeGreaterThan(5);
  });
  it("no category returns everything, including shared base tokens", async () => {
    const r = await tool("get_tokens", { brand: "tarnbury", format: "css" });
    expect(r.structuredContent.css).toContain("--space-4: 16px;");
    expect(r.structuredContent.css).toContain("--type-heading:");
  });
  it("rejects an unknown category", async () => {
    const r = await tool("get_tokens", { brand: "tarnbury", category: "shadow" });
    expect(r.isError === true || r.code !== undefined).toBe(true);
  });
});

describe("get_color_rules", () => {
  it("returns the minimums, decoration colours and computed pair ratios", async () => {
    const r = (await tool("get_color_rules", { brand: "pellmoor" })).structuredContent;
    expect(r.min_contrast).toEqual({ body: 7, large: 4.5 });
    expect(r.decoration_only[0].token).toBe("color.palette.sun");
    const p = r.allowed_pairs.find((x: any) => x.foreground.token === "color.palette.slate" && x.background.token === "color.palette.bone");
    expect(p.ratio).toBeGreaterThan(12);
    expect(p.text_sizes).toEqual(["body", "large"]);
    expect(p.foreground.hex).toBe("#1f2b33");
  });
});

describe("check_contrast", () => {
  it("black on white is 21", async () => {
    const r = (await tool("check_contrast", { brand: "tarnbury", foreground: "#000", background: "#fff", text_size: "body" })).structuredContent;
    expect(r.ratio).toBe(21);
    expect(r.wcag_aa).toEqual({ required: 4.5, pass: true });
    expect(r.allowed_by_brand_rules).toBe(false);
  });
  it("#767676 on white is 4.54 and passes AA body", async () => {
    const r = (await tool("check_contrast", { brand: "tarnbury", foreground: "#767676", background: "#ffffff", text_size: "body" })).structuredContent;
    expect(r.ratio).toBe(4.54);
    expect(r.wcag_aa.pass).toBe(true);
  });
  it("#777777 on white fails AA body but passes large", async () => {
    const body = (await tool("check_contrast", { brand: "tarnbury", foreground: "#777", background: "#fff", text_size: "body" })).structuredContent;
    const large = (await tool("check_contrast", { brand: "tarnbury", foreground: "#777", background: "#fff", text_size: "large" })).structuredContent;
    expect(body.wcag_aa.pass).toBe(false);
    expect(large.wcag_aa.pass).toBe(true);
  });
  it("accepts palette names and reports an allowed pair", async () => {
    const r = (await tool("check_contrast", { brand: "tarnbury", foreground: "heather", background: "oat", text_size: "body" })).structuredContent;
    expect(r.foreground).toBe("#6a2c5b");
    expect(r.allowed_by_brand_rules).toBe(true);
    expect(r.reason).toContain("Allowed");
  });
  it("applies the brand's stricter minimum separately from AA", async () => {
    const r = (await tool("check_contrast", { brand: "pellmoor", foreground: "bone", background: "pine", text_size: "body" })).structuredContent;
    expect(r.wcag_aa.pass).toBe(true);
    expect(r.brand_minimum).toEqual({ required: 7, pass: false });
    expect(r.allowed_by_brand_rules).toBe(false);
    expect(r.reason).toContain("large");
  });
  it("blocks decoration-only colours for text", async () => {
    const r = (await tool("check_contrast", { brand: "tarnbury", foreground: "honey", background: "porridge", text_size: "large" })).structuredContent;
    expect(r.allowed_by_brand_rules).toBe(false);
    expect(r.reason).toContain("decoration-only");
  });
  it("returns a tool error for a value that is not a colour", async () => {
    const r = await tool("check_contrast", { brand: "tarnbury", foreground: "banana", background: "#fff", text_size: "body" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not a colour");
  });
});

describe("get_format", () => {
  it("lists a channel's placements", async () => {
    const r = (await tool("get_format", { brand: "tarnbury", channel: "social" })).structuredContent;
    expect(r.placements.map((p: any) => p.id)).toEqual(["square-post", "story"]);
  });
  it("returns one placement with its slots", async () => {
    const r = (await tool("get_format", { brand: "pellmoor", channel: "web", placement: "hero" })).structuredContent;
    expect(r.placements).toHaveLength(1);
    expect(r.placements[0]).toMatchObject({ width: 1920, height: 720, unit: "px" });
    expect(r.placements[0].slots.map((s: any) => s.name)).toContain("call-to-action");
  });
  it("tool error for an unknown placement", async () => {
    const r = await tool("get_format", { brand: "pellmoor", channel: "web", placement: "nope" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Available: hero, card");
  });
});

describe("search_brand", () => {
  it("finds tokens, pairs and placements, ranked", async () => {
    const r = (await tool("search_brand", { brand: "tarnbury", query: "story" })).structuredContent;
    expect(r.hits[0]).toMatchObject({ kind: "placement", id: "social/story" });
    const t = (await tool("search_brand", { brand: "pellmoor", query: "primary" })).structuredContent;
    expect(t.hits.some((h: any) => h.id === "color.role.primary")).toBe(true);
  });
  it("returns zero hits, not an error, for no match", async () => {
    const r = (await tool("search_brand", { brand: "tarnbury", query: "zzzzqq" })).structuredContent;
    expect(r).toMatchObject({ total: 0, hits: [] });
  });
});

describe("brand enum", () => {
  it.each(["get_tokens", "get_color_rules", "get_format", "check_contrast", "search_brand"])("%s rejects an unknown brand", async (name) => {
    const r = await tool(name, { brand: "acme", channel: "web", foreground: "#000", background: "#fff", text_size: "body", query: "x" });
    expect(r.isError === true || r.code !== undefined).toBe(true);
    expect(JSON.stringify(r)).not.toContain("acme-ok");
  });
});

describe("resources and prompt", () => {
  it("reads brand://tarnbury/tokens as DTCG JSON", async () => {
    const r = await rpc("resources/read", { uri: "brand://tarnbury/tokens" });
    expect(r.result.contents[0].mimeType).toBe("application/design-tokens+json");
    expect(JSON.parse(r.result.contents[0].text).color.palette.heather.$type).toBe("color");
  });
  it("reads brand://pellmoor/rules", async () => {
    const r = await rpc("resources/read", { uri: "brand://pellmoor/rules" });
    const j = JSON.parse(r.result.contents[0].text);
    expect(j.colors.min_contrast.body).toBe(7);
    expect(j.formats.channels.print[0].id).toBe("trail-sign");
  });
  it("review_colors builds a message that uses the tools", async () => {
    const r = await rpc("prompts/get", { name: "review_colors", arguments: { brand: "tarnbury", work: "p { color: #123456 }" } });
    expect(r.result.messages[0].content.text).toContain("check_contrast");
    expect(r.result.messages[0].content.text).toContain("#123456");
  });
});
