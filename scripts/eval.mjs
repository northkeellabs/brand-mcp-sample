#!/usr/bin/env node
// Eval: verifiable questions answered through a real MCP client against a running `wrangler dev`.
//   npm run dev        (in one terminal)
//   npm run eval       (in another; default http://localhost:8787/mcp)
// Each question is answered by calling the server (initialize, tools/list, tools/call, resources/read, prompts/get)
// and the answer is checked in code against expected values read straight from the token and rule source files,
// or computed with an independent contrast formula below. Writes scripts/eval-output.txt. Exit code 1 on any failure.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFileSync, writeFileSync } from "node:fs";

const URL_ = process.argv[2] || "http://localhost:8787/mcp";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Independent WCAG 2.1 formula (not imported from src/) so the eval cross-checks the server's maths.
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const trunc2 = (r) => Math.floor(r * 100) / 100;

const tok = (brand, file) => readJson(`tokens/${brand}/${file}.tokens.json`);
const hexOf = (brand, name) => tok(brand, "figma").color.palette[name].$value.hex;
const fmt = (brand) => readJson(`rules/${brand}/formats.json`);
const col = (brand) => readJson(`rules/${brand}/colors.json`);

const client = new Client({ name: "brand-eval", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, data: r.structuredContent, text: r.content?.[0]?.text ?? "" };
};

const results = [];
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
async function q(id, question, fn) {
  try {
    const { pass, got, expected } = await fn();
    results.push(pass);
    log(`${pass ? "PASS" : "FAIL"}  Q${String(id).padStart(2, "0")}  ${question}${pass ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`}`);
  } catch (e) {
    results.push(false);
    log(`FAIL  Q${String(id).padStart(2, "0")}  ${question}\n        threw ${e?.message ?? e}`);
  }
}
const eq = (got, expected) => ({ pass: JSON.stringify(got) === JSON.stringify(expected), got, expected });

const info = client.getServerVersion?.();
log(`Eval against ${URL_}  (${new Date().toISOString().slice(0, 10)})  server: ${info?.name} ${info?.version}`);

// ---- protocol surface
await q(1, "tools/list returns exactly the 5 tools, all marked read-only", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const allRead = tools.every((t) => t.annotations?.readOnlyHint === true);
  return eq({ names, allRead }, { names: ["check_contrast", "get_color_rules", "get_format", "get_tokens", "search_brand"], allRead: true });
});
await q(2, "resources/list shows brand://<brand>/tokens and /rules for both brands", async () => {
  const { resources } = await client.listResources();
  return eq(resources.map((r) => r.uri).sort(), ["brand://pellmoor/rules", "brand://pellmoor/tokens", "brand://tarnbury/rules", "brand://tarnbury/tokens"]);
});

// ---- tokens
await q(3, "What is the primary colour of tarnbury?", async () => {
  const r = await call("get_tokens", { brand: "tarnbury", category: "color", format: "css" });
  const m = /--color-role-primary:\s*(#[0-9a-f]{6})/i.exec(r.data.css);
  return eq(m?.[1], hexOf("tarnbury", "heather"));
});
await q(4, "What is the primary colour of pellmoor?", async () => {
  const r = await call("get_tokens", { brand: "pellmoor", category: "color", format: "css" });
  const m = /--color-role-primary:\s*(#[0-9a-f]{6})/i.exec(r.data.css);
  return eq(m?.[1], hexOf("pellmoor", "pine"));
});
await q(5, "In the DTCG output, which palette token does pellmoor's accent role point at?", async () => {
  const r = await call("get_tokens", { brand: "pellmoor", category: "color", format: "dtcg" });
  return eq(r.data.dtcg.color.role.accent.$value, "{color.palette.signal}");
});
await q(6, "What is tarnbury's heading font stack (CSS)?", async () => {
  const r = await call("get_tokens", { brand: "tarnbury", category: "font", format: "css" });
  const m = /--font-family-heading:\s*([^;]+);/.exec(r.data.css);
  return eq(m?.[1], "Georgia, Cambria, serif");
});
await q(7, "What is the largest font size token (xxl) of tarnbury?", async () => {
  const r = await call("get_tokens", { brand: "tarnbury", category: "font", format: "css" });
  const m = /--font-size-xxl:\s*([^;]+);/.exec(r.data.css);
  return eq(m?.[1], `${tok("tarnbury", "figma").font.size.xxl.$value.value}px`);
});
await q(8, "What does the shared base spacing token space.6 resolve to for pellmoor?", async () => {
  const r = await call("get_tokens", { brand: "pellmoor", category: "space", format: "css" });
  const m = /--space-6:\s*([^;]+);/.exec(r.data.css);
  return eq(m?.[1], "32px");
});

// ---- contrast
const cc = (brand, fg, bg, size) => call("check_contrast", { brand, foreground: fg, background: bg, text_size: size });
await q(9, "Is #000000 on #ffffff 21:1?", async () => eq((await cc("tarnbury", "#000000", "#ffffff", "body")).data.ratio, 21));
await q(10, "Does #767676 on #ffffff pass AA for body text, and what is the ratio?", async () => {
  const d = (await cc("tarnbury", "#767676", "#ffffff", "body")).data;
  return eq({ ratio: d.ratio, aa: d.wcag_aa.pass }, { ratio: trunc2(ratio("#767676", "#ffffff")), aa: true });
});
await q(11, "Does #777777 on #ffffff pass AA for body text?", async () => {
  const d = (await cc("tarnbury", "#777777", "#ffffff", "body")).data;
  return eq({ ratio: d.ratio, aa: d.wcag_aa.pass }, { ratio: trunc2(ratio("#777777", "#ffffff")), aa: false });
});
await q(12, "Does tarnbury's heather on oat pass AA body text and is the pair allowed?", async () => {
  const d = (await cc("tarnbury", "heather", "oat", "body")).data;
  return eq({ ratio: d.ratio, aa: d.wcag_aa.pass, allowed: d.allowed_by_brand_rules }, { ratio: trunc2(ratio(hexOf("tarnbury", "heather"), hexOf("tarnbury", "oat"))), aa: true, allowed: true });
});
await q(13, "Pellmoor bone on pine at body size: passes AA, meets the brand's stricter minimum, allowed?", async () => {
  const d = (await cc("pellmoor", "bone", "pine", "body")).data;
  const r = ratio(hexOf("pellmoor", "bone"), hexOf("pellmoor", "pine"));
  return eq({ aa: d.wcag_aa.pass, brandMin: d.brand_minimum.pass, allowed: d.allowed_by_brand_rules }, { aa: r >= 4.5, brandMin: r >= col("pellmoor").minContrast.body, allowed: false });
});
await q(14, "Pellmoor bone on pine at large size: allowed by the brand rules?", async () => eq((await cc("pellmoor", "bone", "pine", "large")).data.allowed_by_brand_rules, true));
await q(15, "May tarnbury's decoration-only honey carry text (honey on porridge, large)?", async () => {
  const d = (await cc("tarnbury", "honey", "porridge", "large")).data;
  return eq(d.allowed_by_brand_rules, false);
});

// ---- formats
await q(16, "What size is tarnbury's social story placement?", async () => {
  const p = (await call("get_format", { brand: "tarnbury", channel: "social", placement: "story" })).data.placements[0];
  return eq([p.width, p.height, p.unit], [1080, 1920, "px"]);
});
await q(17, "What size is pellmoor's print trail-sign?", async () => {
  const p = (await call("get_format", { brand: "pellmoor", channel: "print", placement: "trail-sign" })).data.placements[0];
  return eq([p.width, p.height, p.unit], [297, 420, "mm"]);
});
await q(18, "How many web placements does pellmoor have?", async () => eq((await call("get_format", { brand: "pellmoor", channel: "web" })).data.placements.length, fmt("pellmoor").channels.web.length));
await q(19, "What is the maximum headline length in tarnbury's email header?", async () => {
  const p = (await call("get_format", { brand: "tarnbury", channel: "email", placement: "header" })).data.placements[0];
  return eq(p.slots.find((s) => s.name === "headline").maxChars, 45);
});

// ---- search, resources, prompt, errors
await q(20, "search_brand tarnbury 'story': which placement comes first?", async () => eq((await call("search_brand", { brand: "tarnbury", query: "story" })).data.hits[0].id, "social/story"));
await q(21, "Resource brand://pellmoor/rules: what body contrast does the brand require?", async () => {
  const r = await client.readResource({ uri: "brand://pellmoor/rules" });
  return eq(JSON.parse(r.contents[0].text).colors.min_contrast.body, 7);
});
await q(22, "Resource brand://tarnbury/tokens is valid DTCG with a colour object for oat", async () => {
  const r = await client.readResource({ uri: "brand://tarnbury/tokens" });
  const oat = JSON.parse(r.contents[0].text).color.palette.oat;
  return eq([oat.$type, oat.$value.colorSpace, oat.$value.hex], ["color", "srgb", hexOf("tarnbury", "oat")]);
});
await q(23, "Prompt review_colors tells the model to use check_contrast and names the brand", async () => {
  const p = await client.getPrompt({ name: "review_colors", arguments: { brand: "pellmoor", work: "h1 { color: #c4400f; background: #f3f0e8 }" } });
  const text = p.messages[0].content.text;
  return eq([text.includes("check_contrast"), text.includes("Pellmoor Outdoors"), text.includes("#c4400f")], [true, true, true]);
});
await q(24, "An unknown brand is rejected, not answered", async () => {
  let rejected = false;
  try {
    const r = await client.callTool({ name: "get_color_rules", arguments: { brand: "acme" } });
    rejected = !!r.isError;
  } catch { rejected = true; }
  return eq(rejected, true);
});

const passed = results.filter(Boolean).length;
log(`\nEVAL: ${passed}/${results.length} passed`);
writeFileSync("scripts/eval-output.txt", lines.join("\n") + "\n");
await client.close();
process.exit(passed === results.length ? 0 : 1);
