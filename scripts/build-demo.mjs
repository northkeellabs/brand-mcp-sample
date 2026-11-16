#!/usr/bin/env node
// Builds the static demo page from the real build outputs: build/<brand>/tokens.css, rules/, scripts/samples-output.json
// (captured from `wrangler dev`), scripts/eval-output.txt and the vitest JSON reports. Nothing on the page is typed in by hand
// except explanatory prose. Run order: npm run build, npm run test:report, npm run eval, npm run samples, npm run build:demo.
//
//   DEMO_DIR=<folder> node scripts/build-demo.mjs     (default: ./demo-out)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS } from "./brands.mjs";
import { contrastRatio } from "../src/contrast.mjs";

const DEMO_DIR = process.env.DEMO_DIR || "demo-out";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pkg = readJson("package.json");
const ver = (name) => readJson(`node_modules/${name}/package.json`).version;
const samples = readJson("scripts/samples-output.json");
const evalLines = readFileSync("scripts/eval-output.txt", "utf8").split("\n").filter(Boolean);
const worker = readJson("scripts/test-results-worker.json");
const auth = readJson("scripts/test-results-auth.json");
const node = readJson("scripts/test-results-node.json");
const ENDPOINT = "https://brand-mcp.northkeellabs.com/mcp";
const REPO = "https://github.com/northkeellabs/brand-mcp-sample";
const SIGNIN_NOTE =`The server shown above is open and read-only because it holds only invented data. The code also includes an optional sign-in entry point: OAuth 2.1 with Google as the upstream login, tested against mocked Google endpoints (${auth.numTotalTests} tests). It is not deployed here, and no Google account or credentials were created.`;

const NAMES = { tarnbury: "Tarnbury Oats", pellmoor: "Pellmoor Outdoors" };
const BLURB = {
  tarnbury: "Invented breakfast brand: oats, porridge, warm and a little old-fashioned.",
  pellmoor: "Invented hiking gear brand: technical, plain, built for weather.",
};
const SAMPLE_TEXT = { tarnbury: ["Warm oats, slow mornings", "Stone-cut oats from a field you will never visit. Ready in four minutes."], pellmoor: ["Light packs, long trails", "Waterproof, repairable and tested on a hill we would rather not name."] };
const BUTTON = { tarnbury: "Find a stockist", pellmoor: "Plan a route" };

// ------------------------------------------------------------------ data per brand
function brandData(b) {
  const flat = readJson(`build/${b}/tokens.list.json`);
  const colors = readJson(`rules/${b}/colors.json`);
  const formats = readJson(`rules/${b}/formats.json`);
  const dtcgColors = readJson(`tokens/${b}/color.tokens.json`).color;
  const hex = Object.fromEntries(flat.filter((t) => t.path.startsWith("color.palette.")).map((t) => [t.path.replace("color.palette.", ""), t.value]));
  const sizes = flat.filter((t) => t.path.startsWith("font.size.")).map((t) => ({ name: t.path.replace("font.size.", ""), value: t.value }));
  const family = Object.fromEntries(flat.filter((t) => t.path.startsWith("font.family.")).map((t) => [t.path.replace("font.family.", ""), t.value]));
  return { b, flat, colors, formats, dtcgColors, hex, sizes, family };
}
const data = Object.fromEntries(BRANDS.map((b) => [b, brandData(b)]));

function pairRows(d) {
  const short = (p) => p.replace("color.palette.", "");
  const allowed = d.colors.allowedPairs.map((p) => ({ fg: short(p.foreground), bg: short(p.background), sizes: p.textSizes, use: p.use, ok: true }));
  const key = (f, g) => `${f}|${g}`;
  const have = new Set(allowed.map((p) => key(p.fg, p.bg)));
  const deco = new Set(d.colors.decorationOnly.map(short));
  // blocked examples: the three lowest-contrast pairs among non-decoration colours that are not on the allowed list
  const names = Object.keys(d.hex).filter((n) => !deco.has(n));
  const blocked = [];
  for (const f of names) for (const g of names) if (f !== g && !have.has(key(f, g))) blocked.push({ fg: f, bg: g, r: contrastRatio(d.hex[f], d.hex[g]) });
  blocked.sort((a, c) => a.r - c.r);
  const picks = [blocked[0], blocked[Math.floor(blocked.length / 3)]].map((x) => ({ fg: x.fg, bg: x.bg, sizes: [], use: "not in the allowed pairs", ok: false }));
  const decoPick = [...deco].map((n) => ({ fg: n, bg: names.find((x) => x !== n && contrastRatio(d.hex[n], d.hex[x]) > 3) ?? names[0], sizes: [], use: "decoration only, never text", ok: false }));
  return [...allowed, ...picks, ...decoPick].map((p) => ({ ...p, ratio: Math.floor(contrastRatio(d.hex[p.fg], d.hex[p.bg]) * 100) / 100 }));
}

// ------------------------------------------------------------------ html pieces
function panel(b) {
  const d = data[b];
  const roles = Object.entries(d.dtcgColors.role).map(([r, t]) => `<li><span class="mono">${esc(r)}</span><span class="arrow" aria-hidden="true">&rarr;</span><span class="mono">${esc(t.$value)}</span></li>`).join("");
  const swatches = Object.entries(d.dtcgColors.palette)
    .map(([n, t]) => `<li class="sw"><span class="chip" style="background:var(--color-palette-${n})"></span><span class="sw-name">${esc(n)}</span><span class="mono sw-hex">${esc(t.$value.hex)}</span><span class="sw-desc">${esc(t.$description || "")}</span></li>`)
    .join("");
  const scale = [...d.sizes].reverse().map((s) => `<li><span class="mono scale-tag">${esc(s.name)} ${esc(s.value)}</span><span class="scale-line ${["lg", "xl", "xxl"].includes(s.name) ? "h" : "b"}" style="font-size:var(--font-size-${s.name})">${esc(SAMPLE_TEXT[b][0])}</span></li>`).join("");
  const rows = pairRows(d)
    .map((p) => `<tr class="${p.ok ? "ok" : "no"}"><td><span class="pair" style="color:var(--color-palette-${p.fg});background:var(--color-palette-${p.bg})">Aa</span></td><td class="mono">${esc(p.fg)} on ${esc(p.bg)}</td><td class="mono ratio">${p.ratio.toFixed(2)}</td><td>${p.ok ? esc(p.sizes.join(" + ")) : "blocked"}</td><td>${esc(p.use)}</td></tr>`)
    .join("");
  const min = d.colors.minContrast;
  const placements = Object.entries(d.formats.channels).map(([c, l]) => `${c}: ${l.map((p) => `${p.id} ${p.width}x${p.height} ${p.unit}`).join(", ")}`).join("; ");
  return `
<div class="panel" id="panel-${b}" data-brand="${b}" role="tabpanel" aria-labelledby="tab-${b}">
  <div class="specimen">
    <p class="brandline"><strong>${esc(NAMES[b])}</strong> <span>${esc(BLURB[b])}</span></p>
    <div class="spec-grid">
      <div>
        <h3>Palette</h3>
        <ul class="swatches">${swatches}</ul>
      </div>
      <div>
        <h3>Sample card</h3>
        <div class="card">
          <p class="card-eyebrow mono">${esc(b)}.tokens.json</p>
          <h4>${esc(SAMPLE_TEXT[b][0])}</h4>
          <p>${esc(SAMPLE_TEXT[b][1])}</p>
          <p><span class="btn">${esc(BUTTON[b])}</span></p>
        </div>
        <h3>Shape and space</h3>
        <div class="shape"><span class="box small">radius small</span><span class="box large">radius large</span></div>
      </div>
    </div>
    <h3>Type scale <span class="muted">(Style Dictionary output: ${esc(d.family.heading)} / ${esc(d.family.body)})</span></h3>
    <ul class="scale">${scale}</ul>
  </div>
  <h3>Roles are aliases (DTCG <span class="mono">{curly}</span> references)</h3>
  <ul class="roles">${roles}</ul>
  <h3>Colour rules: allowed pairs and blocked examples</h3>
  <p class="note">This brand requires a contrast ratio of at least <strong>${min.body}</strong> for body text and <strong>${min.large}</strong> for large text. Ratios are computed from the token hex values.</p>
  <div class="table-wrap"><table class="pairs"><thead><tr><th scope="col">Sample</th><th scope="col">Pair</th><th scope="col">Ratio</th><th scope="col">Text sizes</th><th scope="col">Rule</th></tr></thead><tbody>${rows}</tbody></table></div>
  <h3>Placement formats</h3>
  <p class="note mono">${esc(placements)}</p>
</div>`;
}

const compact = (v) => JSON.stringify(v, null, 2);
const call = (k) => samples.calls[k];
function sampleBlock(key, title, useWhen, opts = {}) {
  const c = call(key);
  const req = compact(c.request);
  let result = c.response.result;
  let note = "";
  if (opts.structured && result.structuredContent) result = { structuredContent: result.structuredContent };
  if (opts.truncateText && result.contents) {
    result = { contents: result.contents.map((x) => ({ ...x, text: x.text.slice(0, 420) + " ..." })) };
    note = "The resource text is cut to its first 420 characters here; the real response carries the whole JSON document.";
  }
  if (opts.structured) note = "Shown: the structuredContent of the response. The real response repeats it as a JSON string in content[0].text.";
  const resp = compact({ jsonrpc: c.response.jsonrpc, id: c.response.id, result });
  return `
<details class="call"${opts.open ? " open" : ""}>
  <summary><span class="mono tool-name">${esc(title)}</span><span class="when">${esc(useWhen)}</span></summary>
  <div class="io">
    <div><p class="label">Request</p><pre class="code"><code>${esc(req)}</code></pre></div>
    <div><p class="label">Response</p><pre class="code scroll"><code>${esc(resp)}</code></pre></div>
  </div>
  ${note ? `<p class="note">${esc(note)}</p>` : ""}
</details>`;
}

const toolDesc = Object.fromEntries(call("tools/list").response.result.tools.map((t) => [t.name, t.description]));
const firstSentences = (t, n) => t.split(/(?<=\.)\s+/).slice(0, n).join(" ");
const toolsHtml = [
  sampleBlock("get_tokens", "get_tokens(brand, category?, format)", firstSentences(toolDesc.get_tokens, 2), { structured: true }),
  sampleBlock("get_color_rules", "get_color_rules(brand)", firstSentences(toolDesc.get_color_rules, 2), { structured: true }),
  sampleBlock("check_contrast", "check_contrast(brand, foreground, background, text_size)", firstSentences(toolDesc.check_contrast, 2), { structured: true, open: true }),
  sampleBlock("get_format", "get_format(brand, channel, placement?)", firstSentences(toolDesc.get_format, 2), { structured: true }),
  sampleBlock("search_brand", "search_brand(brand, query)", firstSentences(toolDesc.search_brand, 2), { structured: true }),
  sampleBlock("resources/read", "resources/read brand://pellmoor/rules", "Resources: brand://<brand>/tokens and brand://<brand>/rules return the whole document for a brand.", { truncateText: true }),
  sampleBlock("prompts/get", "prompts/get review_colors", "Prompt: asks the model to review a piece of work against a brand's colour rules, using the tools above."),
].join("");

// ------------------------------------------------------------------ tests and evals
const allTests = [...worker.testResults, ...auth.testResults, ...node.testResults].flatMap((f) => f.assertionResults.map((a) => ({ group: a.ancestorTitles[0] || "other", file: f.name.includes("/auth/") ? "Workers runtime, sign-in" : f.name.includes("/worker/") ? "Workers runtime" : "Node", status: a.status })));
const total = allTests.length;
const passed = allTests.filter((t) => t.status === "passed").length;
const groups = [...new Set(allTests.map((t) => `${t.file}|${t.group}`))].map((g) => {
  const [file, group] = g.split("|");
  const rows = allTests.filter((t) => t.file === file && t.group === group);
  return `<tr><td>${esc(file)}</td><td>${esc(group)}</td><td class="mono ratio">${rows.filter((r) => r.status === "passed").length}/${rows.length}</td></tr>`;
}).join("");
const evalQ = evalLines.filter((l) => /^(PASS|FAIL)\s+Q\d+/.test(l));
const evalSummary = evalLines.find((l) => l.startsWith("EVAL:")) || "";
const evalHead = evalLines[0] || "";
const runDate = (evalHead.match(/\((\d{4}-\d{2}-\d{2})\)/) || [])[1] || new Date().toISOString().slice(0, 10);
const evalRows = evalQ.map((l) => { const m = /^(PASS|FAIL)\s+(Q\d+)\s+(.*)$/.exec(l); return `<li class="${m[1] === "PASS" ? "ok" : "no"}"><span class="mono">${m[1]}</span> <span class="mono">${m[2]}</span> ${esc(m[3])}</li>`; }).join("");

const versions = [
  ["DTCG format", "2025.10 (first stable version)"],
  ["Style Dictionary", ver("style-dictionary")],
  ["MCP TypeScript SDK (@modelcontextprotocol/server)", ver("@modelcontextprotocol/server")],
  ["agents (createMcpHandler)", ver("agents")],
  ["zod", ver("zod")],
  ["wrangler", ver("wrangler")],
  ["vitest", ver("vitest")],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Brand MCP server sample</title>
<link rel="stylesheet" href="page.css">
<link rel="stylesheet" href="tokens-tarnbury.css">
<link rel="stylesheet" href="tokens-pellmoor.css">
<link rel="icon" href="data:,">
</head>
<body>
<p class="sample-bar">SAMPLE - invented brands - not a client project - Northkeel Labs demo</p>
<main>
  <header class="top">
    <h1>Brand MCP server with design tokens</h1>
    <p class="lead">A remote MCP server that lets AI agents pull a brand's design tokens and rules, and check their own colour choices against them.</p>
    <p class="lead">Built here on two invented brands to show the token pipeline and the server pattern end to end, with real tests.</p>
    <dl class="facts">
      <div><dt>Server</dt><dd>TypeScript, MCP TypeScript SDK ${esc(ver("@modelcontextprotocol/server"))}, one Cloudflare Worker, one <span class="mono">/mcp</span> endpoint, streamable HTTP, stateless, read-only</dd></div>
      <div><dt>Tokens</dt><dd>DTCG 2025.10 JSON, built with Style Dictionary ${esc(ver("style-dictionary"))} into CSS custom properties and a TypeScript module</dd></div>
      <div><dt>Brands</dt><dd>Tarnbury Oats and Pellmoor Outdoors, both invented, no real logos, names checked by web search</dd></div>
    </dl>
  </header>

  <section id="tokens">
    <h2><span class="num mono">1</span> Tokens, rendered from the built CSS</h2>
    <p>Everything inside the framed area uses the real <span class="mono">tokens.css</span> that Style Dictionary produced for that brand. Switching brand changes one attribute, <span class="mono">data-brand</span>, and nothing else.</p>
    <div class="switch" role="tablist" aria-label="Brand">
      <button type="button" role="tab" id="tab-tarnbury" aria-controls="panel-tarnbury" aria-selected="true" data-target="tarnbury">Tarnbury Oats</button>
      <button type="button" role="tab" id="tab-pellmoor" aria-controls="panel-pellmoor" aria-selected="false" data-target="pellmoor">Pellmoor Outdoors</button>
    </div>
    <div class="panels">${BRANDS.map(panel).join("")}
    </div>
    <p class="note">Rules are JSON files checked by a JSON Schema, then checked again against the tokens: every colour reference must exist, no decoration colour may carry text, and each allowed pair must really meet the brand's minimum contrast for the text sizes it claims. A bad rule stops the build (there is a test that proves it).</p>
  </section>

  <section id="pipeline">
    <h2><span class="num mono">2</span> The token pipeline</h2>
    <ol class="pipe">
      <li class="stage future"><span class="stage-name">Figma Variables</span><span class="stage-sub">Where designers edit. Exported to DTCG JSON. Not built in this sample.</span></li>
      <li class="stage"><span class="stage-name">DTCG JSON</span><span class="stage-sub mono">tokens/&lt;brand&gt;/<wbr>*.tokens.json plus shared base</span></li>
      <li class="stage"><span class="stage-name">Style Dictionary v5</span><span class="stage-sub mono">npm run build:tokens</span></li>
      <li class="stage"><span class="stage-name">CSS and TypeScript</span><span class="stage-sub mono">build/&lt;brand&gt;/<wbr>tokens.css, src/<wbr>generated/<wbr>tokens.ts</span></li>
      <li class="stage"><span class="stage-name">MCP tools</span><span class="stage-sub">get_tokens and the rest read the generated module</span></li>
    </ol>
    <p class="note">One npm script runs the whole build: <span class="mono">npm run build</span> builds the tokens, then checks the rules. Colours use the 2025.10 colour object (<span class="mono">colorSpace</span>, <span class="mono">components</span>, <span class="mono">alpha</span>, <span class="mono">hex</span>) and dimensions use <span class="mono">{ value, unit }</span>.</p>
  </section>

  <section id="tools">
    <h2><span class="num mono">3</span> The server: 5 tools, 4 resources, 1 prompt</h2>
    <p>Every tool takes <span class="mono">brand</span> as an enum, validated with zod, so an unknown brand is rejected before any code runs. Every tool is marked read-only. Each block below is one real request and response from the server running locally under <span class="mono">wrangler dev</span>, captured on ${esc(samples.captured_at.slice(0, 10))}. Click a line to open it.</p>
    ${toolsHtml}
  </section>

  <section id="connect">
    <h2><span class="num mono">4</span> Connect to the hosted server</h2>
    <p>The server is live at <span class="mono">${ENDPOINT}</span>. No sign-in is needed: it is read-only and holds only invented data. Pick a client:</p>
    <ul class="versions">
      <li><span>claude.ai or Claude Desktop</span><span>Settings, Connectors, add a custom connector, paste the URL, leave the sign-in fields empty.</span></li>
      <li><span>MCP Inspector</span><span class="mono">npx @modelcontextprotocol/inspector</span></li>
    </ul>
    <p class="note">In MCP Inspector choose the Streamable HTTP transport and paste the URL. For Cursor, add this to <span class="mono">mcp.json</span>:</p>
    <pre class="code"><code>{
  "mcpServers": {
    "brand-mcp-sample": { "url": "${ENDPOINT}" }
  }
}</code></pre>
    <p class="note">Or check it with a plain HTTP client (the Accept header is required by streamable HTTP):</p>
    <pre class="code"><code>curl -s ${ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</code></pre>
    <p class="note">Source code (MIT): <a href="${REPO}">${REPO}</a></p>
  </section>

  <section id="tests">
    <h2><span class="num mono">5</span> Tests and evals</h2>
    <p class="big"><span class="mono">${passed}/${total}</span> automated tests pass, and <span class="mono">${esc(evalSummary.replace("EVAL: ", "").replace(" passed", ""))}</span> eval questions pass against the hosted server at <span class="mono">${ENDPOINT}</span>. Run on ${esc(runDate)}.</p>
    <div class="table-wrap"><table class="tests"><thead><tr><th scope="col">Runner</th><th scope="col">Group</th><th scope="col">Passed</th></tr></thead><tbody>${groups}</tbody></table></div>
    <p class="note">Unit and tool tests run in the Cloudflare Workers runtime through vitest. The build and rule tests run in Node: token output, contrast maths against known values (#000 on #fff is 21, #767676 on #fff is about 4.54), schema rejection of bad rules, and the build exiting non-zero on a bad rule.</p>
    <details class="call">
      <summary><span class="mono tool-name">Eval: ${evalQ.length} questions</span><span class="when">Each answered through a real MCP client against the hosted server (initialize, tools/list, tool calls, resource reads), and checked in code.</span></summary>
      <ul class="evals">${evalRows}</ul>
    </details>
    <h3>Versions used</h3>
    <ul class="versions">${versions.map(([k, v]) => `<li><span>${esc(k)}</span><span class="mono">${esc(v)}</span></li>`).join("")}</ul>
    <h3>How to run it</h3>
    <pre class="code"><code>npm install
npm run build          # tokens with Style Dictionary, then the rule checks
npm test               # build, then ${worker.numTotalTests} Workers-runtime tests, ${auth.numTotalTests} sign-in tests and ${node.numTotalTests} Node tests
npm run dev            # wrangler dev on http://localhost:8787/mcp
npm run eval           # ${evalQ.length} questions through a real MCP client (needs npm run dev)
npm run eval -- ${ENDPOINT}   # the same questions against the hosted server</code></pre>
  </section>

  <footer class="foot">
    <p>${esc(SIGNIN_NOTE)}</p>
    <p><strong>Source code: <a href="${REPO}">${REPO}</a> (MIT licence).</strong></p>
  </footer>
</main>
<script src="page.js"></script>
</body>
</html>
`;

mkdirSync(DEMO_DIR, { recursive: true });
writeFileSync(join(DEMO_DIR, "index.html"), html);
for (const f of ["page.css", "page.js"]) copyFileSync(`scripts/demo-assets/${f}`, join(DEMO_DIR, f));
for (const b of BRANDS) copyFileSync(`build/${b}/tokens.css`, join(DEMO_DIR, `tokens-${b}.css`));
console.log(`demo page written to ${DEMO_DIR}: ${total} tests (${passed} passed), ${evalQ.length} eval questions`);
