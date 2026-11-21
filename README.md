# brand-mcp-sample

[![CI](https://github.com/northkeellabs/brand-mcp-sample/actions/workflows/ci.yml/badge.svg)](https://github.com/northkeellabs/brand-mcp-sample/actions/workflows/ci.yml)

**SAMPLE project. The two brands (Tarnbury Oats, Pellmoor Outdoors) are invented, there are no real logos, and nothing here is a real company's brand.**

A remote MCP server that gives AI agents a brand's design tokens and rules, and lets them check their own colour choices against those rules. Design tokens are written in the DTCG 2025.10 format, built with Style Dictionary v5, and served by a TypeScript MCP server on Cloudflare Workers.

Hosted, read-only instance: `https://brand-mcp.northkeellabs.com/mcp`

## Why

AI agents that write CSS, slides or ad copy tend to guess brand values. If the tokens and the brand rules sit behind an MCP server, an agent can ask for the exact value, ask which colour pairs are allowed, and check a contrast ratio before it ships anything. The server is read-only and stateless, so it is cheap to host and safe to expose.

## Pipeline

```
Figma Variables                  exported by the plugin in figma/plugin
   -> figma/export/*.tokens.json   the plugin's output, committed
   -> DTCG 2025.10 JSON            tokens/<brand>/*.tokens.json plus shared tokens/base  (npm run tokens:from-figma)
   -> Style Dictionary v5          npm run build:tokens
   -> CSS custom properties        build/<brand>/tokens.css
      and a TypeScript module      src/generated/tokens.ts
   -> rule checks                  npm run check:rules
   -> MCP tools, resources, prompt (src/)
```

- Colours use the 2025.10 colour object (`colorSpace`, `components`, `alpha`, `hex`; only `srgb` is used). Dimensions are `{ value, unit }`. Roles such as `color.role.primary` are aliases to palette tokens.
- Brand rules live in `rules/<brand>/colors.json` and `formats.json`, validated by JSON Schema (ajv). `npm run check:rules` checks them against the built tokens: every colour reference exists, no decoration-only colour carries text, every allowed pair meets the brand's minimum contrast for the text sizes it claims, placement ids are unique, safe margins fit. A failing check stops `npm run build`.

## From Figma Variables

The tokens start as Figma Variables. `figma/plugin` is a small read-only Figma plugin that exports them as DTCG 2025.10 JSON, and `figma/export` holds the output of one real run on a real Figma file with the two invented brands. `npm run tokens:from-figma` copies that export into `tokens/`, and the normal build takes over from there.

**How the Variables are laid out.** One collection, `Primitives`, holds the shared values (space, font weight, line height) and every brand's palette, named `<brand>/color/palette/<name>`. Each brand then has a collection, `Brand: Tarnbury` and `Brand: Pellmoor`, with the role colours (aliases of the palette), radius, spacing (aliases of the shared space scale), font sizes and font families (CSS stacks). The exporter routes a primitive whose first name segment is a brand into that brand's file and drops the prefix, so `tarnbury/color/palette/oat` becomes `color.palette.oat` in `tarnbury.tokens.json`, and an alias to it becomes `{color.palette.oat}`. Shared primitives go to `base.tokens.json`. Figma variable types map to DTCG types: colour to `color` (srgb components plus hex), a number with the font-weight scope to `fontWeight`, with line-height or opacity scope to `number`, any other number to a `px` `dimension`, a string with the font-family scope to a `fontFamily` array.

The exporter also supports the layout a paid Figma plan allows: a single `Brand` collection with one mode per brand. Both layouts give the same files (unit tested with a mocked `figma.variables` API).

**The plugin.** `npm run build:plugin` writes `figma/plugin/dist/code.js` (the exporter plus the plugin entry, concatenated; the built file is committed so the plugin imports without a build, and a test fails if it is stale). In Figma desktop: Plugins, Development, Import plugin from manifest, pick `figma/plugin/manifest.json`, run it, and download the three files into `figma/export`. It never writes to the Figma file and has no network access.

**Two findings from doing it for real.**

1. The free Starter plan allows only 1 mode per collection (`addMode` fails with "Limited to 1 modes only"). One `Brand` collection with a mode per brand was therefore not possible, so each brand got its own collection. A paid plan can use the single-collection layout.
2. Figma stores numbers as 32-bit floats: a line height of 1.15 comes out of the API as 1.149999976158142. The exporter rounds every number to 4 decimals.

**The round-trip test.** The first version of the Figma export was compared with the hand-written `tokens/` files, token by token (path, `$type`, `$value`, aliases as strings, colours by hex and components): 40 tokens per brand, no differences, and nothing in Figma that `tokens/` lacked. `tokens/` held 6 tokens Figma does not: the four typography composites per brand (Figma Variables have no composite type) and the two durations (no millisecond type). Those stay hand-written, in `tokens/base/durations.tokens.json` and `tokens/<brand>/type.tokens.json`. The test still runs in CI and now guards the other direction: `tokens/` must equal what `npm run tokens:from-figma` produces from `figma/export`, and the built CSS must carry the same 46 custom properties and values as before the switch. CI also fails if `figma/plugin/dist` or `tokens/` is out of date.

## What the server offers

One endpoint, `/mcp`, stateless streamable HTTP. Every tool takes `brand` as an enum (`tarnbury` or `pellmoor`), validated with zod, and is marked `readOnlyHint: true`.

| Kind | Name | What it does |
| --- | --- | --- |
| Tool | `get_tokens(brand, category?, format)` | Tokens as DTCG JSON (aliases kept) or ready-to-paste CSS custom properties |
| Tool | `get_color_rules(brand)` | Minimum contrast per text size, decoration-only colours, allowed foreground/background pairs |
| Tool | `check_contrast(brand, foreground, background, text_size)` | WCAG 2.1 ratio (truncated to 2 decimals, never rounded up), AA result, the brand's own minimum, and whether the brand allows the pair. Colours may be hex or palette names |
| Tool | `get_format(brand, channel, placement?)` | Placements per channel (web, social, email, print): size, safe margin, slots |
| Tool | `search_brand(brand, query)` | Keyword search over tokens, colour pairs and placements |
| Resource | `brand://tarnbury/tokens`, `brand://tarnbury/rules`, `brand://pellmoor/tokens`, `brand://pellmoor/rules` | Whole documents for a brand |
| Prompt | `review_colors(brand, work)` | Asks the model to review work against a brand's colour rules using the tools above |

## Connect to the hosted server

No sign-in is needed: the server is read-only and holds only invented data.

- **claude.ai or Claude Desktop:** Settings, Connectors, add a custom connector, paste `https://brand-mcp.northkeellabs.com/mcp`, leave the sign-in fields empty.
- **Cursor**, in `mcp.json`:

  ```json
  {
    "mcpServers": {
      "brand-mcp-sample": { "url": "https://brand-mcp.northkeellabs.com/mcp" }
    }
  }
  ```

- **MCP Inspector:** run `npx @modelcontextprotocol/inspector`, choose the Streamable HTTP transport and paste the URL.
- **Plain HTTP:**

  ```
  curl -s https://brand-mcp.northkeellabs.com/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

## Run it locally

Needs Node 22 or newer.

```
npm ci
npm run build          # Style Dictionary v5 token build, then the rule checks
npm test               # build, then the three vitest projects
npm run build:plugin   # rebuild figma/plugin/dist/code.js
npm run tokens:from-figma   # copy figma/export into tokens/
npm run dev            # wrangler dev on http://localhost:8787/mcp
npm run eval           # 24 questions through a real MCP client (needs npm run dev running)
npm run eval -- https://brand-mcp.northkeellabs.com/mcp   # the same questions against a hosted server
npm run typecheck
```

Deploy your own: change the `name` and the `routes` entry in `wrangler.jsonc` (or remove `routes` and set `workers_dev` to `true`), then `npm run deploy`. The deploy script builds the tokens first because `src/generated/` is build output and is not committed.

Layout: `figma/` (plugin and its export), `tokens/` (DTCG source, generated from `figma/export` apart from durations and typography), `rules/` (JSON rules and schemas), `scripts/` (build, rule check, eval), `src/` (Worker), `test/worker`, `test/auth`, `test/node`, `test/figma`. CI (`.github/workflows/ci.yml`) runs the build, typecheck and all tests on every push and pull request.

## Tests and evals

| Check | Result | Date |
| --- | --- | --- |
| vitest, Workers runtime, server and tools | 29/29 pass | 2026-11-16 |
| vitest, Workers runtime, Google sign-in (mocked Google) | 20/20 pass | 2026-11-16 |
| vitest, Node, token build and rules | 25/25 pass | 2026-11-16 |
| vitest, Node, Figma round trip, exporter (mocked Figma API) and tokens:from-figma | 35/35 pass | 2026-11-16 |
| Eval, 24 questions, real MCP client against local `wrangler dev` | 24/24 pass | 2026-11-16 |
| Eval, 24 questions, real MCP client against the hosted endpoint | 24/24 pass | 2026-11-16 |
| `tsc --noEmit` | clean | 2026-11-16 |

The eval questions are self-written and answered by a real MCP client (initialize, tools/list, tool calls, resource reads); expected values are fixed in the script or computed with an independent contrast formula. It is a small test set, not a benchmark.

## Optional Google sign-in entry point

`src/index-auth.ts` (config `wrangler.auth.jsonc`, `npm run dev:auth`) is a second entry point that puts the same server behind OAuth 2.1 using `@cloudflare/workers-oauth-provider`, with Google as the upstream OpenID Connect login (ID token verified with WebCrypto: signature, issuer, audience, expiry, nonce, verified email, optional email domain allow-list). It needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as secrets (put them in `.dev.vars`, never in the repo).

It is tested with Google's endpoints mocked (20 tests). There has been no real Google round trip, and it is not deployed. Its KV binding in `wrangler.auth.jsonc` is a local placeholder; create a namespace and paste its id before deploying it.

## Versions

DTCG Format Module 2025.10, style-dictionary 5.8.0, @modelcontextprotocol/server 2.4.0 (client 2.4.0 for the eval), agents 0.33.0, zod 4.6.7, wrangler 4.159.0, vitest 5.1.0, typescript 7.0.2, @cloudflare/workers-oauth-provider 1.2.4.

## Limits

- Two invented brands and five tools. A real setup would have more brands and tools.
- Figma Variables cannot hold typography composites or millisecond durations, so those two stay hand-written. The export was done once, by hand, from one Figma file; there is no automatic sync, and the export is not re-run in CI (CI has no Figma access).
- Only the `srgb` colour space was exercised.
- No rate limiting, logging or authentication on the hosted instance; it relies on being read-only and stateless.
- The brand names were checked by web search only, which is not a trademark search.

## Licence

MIT, see `LICENSE`.

---

Built by [Northkeel Labs](https://northkeellabs.com): AI agents and MCP servers that run inside your own systems.
