#!/usr/bin/env node
// Records one real JSON-RPC request and response per tool (plus a resource read and the prompt) from a running `wrangler dev`.
//   node scripts/capture-samples.mjs [http://localhost:8787/mcp]   -> scripts/samples-output.json
import { writeFileSync } from "node:fs";

const URL_ = process.argv[2] || "http://localhost:8787/mcp";
let id = 0;

async function rpc(method, params) {
  const request = { jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) };
  const resp = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(request) });
  const text = await resp.text();
  const data = (resp.headers.get("content-type") || "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).at(-1)
    : text;
  return { request, response: JSON.parse(data) };
}
const callTool = (name, args) => rpc("tools/call", { name, arguments: args });

const samples = {
  captured_at: new Date().toISOString(),
  endpoint: URL_,
  calls: {
    "tools/list": await rpc("tools/list"),
    get_tokens: await callTool("get_tokens", { brand: "tarnbury", category: "color", format: "css" }),
    get_color_rules: await callTool("get_color_rules", { brand: "pellmoor" }),
    check_contrast: await callTool("check_contrast", { brand: "pellmoor", foreground: "bone", background: "pine", text_size: "body" }),
    get_format: await callTool("get_format", { brand: "tarnbury", channel: "social", placement: "story" }),
    search_brand: await callTool("search_brand", { brand: "tarnbury", query: "heading font" }),
    "resources/read": await rpc("resources/read", { uri: "brand://pellmoor/rules" }),
    "prompts/get": await rpc("prompts/get", { name: "review_colors", arguments: { brand: "tarnbury", work: "h1 { color: #b5304f; background: #fffaf0 }" } }),
  },
};
writeFileSync("scripts/samples-output.json", JSON.stringify(samples, null, 2) + "\n");
console.log("captured", Object.keys(samples.calls).join(", "));
