# brand-mcp-sample

**SAMPLE project. The two brands (Tarnbury Oats, Pellmoor Outdoors) are invented, there are no real logos, and nothing here is a real company's brand.**

A remote MCP server that gives AI agents a brand's design tokens and rules, and lets them check their own colour choices against those rules. Design tokens are written in the DTCG 2025.10 format, built with Style Dictionary v5, and served by a TypeScript MCP server on Cloudflare Workers.

Hosted, read-only instance: `https://brand-mcp.northkeellabs.com/mcp`

## Why

AI agents that write CSS, slides or ad copy tend to guess brand values. If the tokens and the brand rules sit behind an MCP server, an agent can ask for the exact value, ask which colour pairs are allowed, and check a contrast ratio before it ships anything. The server is read-only and stateless, so it is cheap to host and safe to expose.

## Pipeline

```
Figma Variables (not built in this sample)
   -> DTCG 2025.10 JSON            tokens/<brand>/*.tokens.json plus shared tokens/base
   -> Style Dictionary v5          npm run build:tokens
   -> CSS custom properties        build/<brand>/tokens.css
      and a TypeScript module      src/generated/tokens.ts
   -> rule checks                  npm run check:rules
   -> MCP tools, resources, prompt (src/)
```

- Colours use the 2025.10 colour object (`colorSpace`, `components`, `alpha`, `hex`; only `srgb` is used). Dimensions are `{ value, unit }`. Roles such as `color.role.primary` are aliases to palette tokens.
- Brand rules live in `rules/<brand>/colors.json` and `formats.json`, validated by JSON Schema (ajv). `npm run check:rules` checks them against the built tokens: every colour reference exists, no decoration-only colour carries text, every allowed pair meets the brand's minimum contrast for the text sizes it claims, placement ids are unique, safe margins fit. A failing check stops `npm run build`.

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
npm run dev            # wrangler dev on http://localhost:8787/mcp
npm run eval           # 24 questions through a real MCP client (needs npm run dev running)
npm run eval -- https://brand-mcp.northkeellabs.com/mcp   # the same questions against a hosted server
npm run typecheck
```

Deploy your own: change the `name` and the `routes` entry in `wrangler.jsonc` (or remove `routes` and set `workers_dev` to `true`), then `npm run deploy`. The deploy script builds the tokens first because `src/generated/` is build output and is not committed.

Layout: `tokens/` (DTCG source), `rules/` (JSON rules and schemas), `scripts/` (build, rule check, eval), `src/` (Worker), `test/worker`, `test/auth`, `test/node`.

## Tests and evals

| Check | Result | Date |
| --- | --- | --- |
| vitest, Workers runtime, server and tools | 29/29 pass | 2026-11-16 |
| vitest, Workers runtime, Google sign-in (mocked Google) | 20/20 pass | 2026-11-16 |
| vitest, Node, token build and rules | 25/25 pass | 2026-11-16 |
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
- The Figma Variables step in the pipeline is not built; tokens are written as DTCG JSON by hand.
- Only the `srgb` colour space was exercised.
- No rate limiting, logging or authentication on the hosted instance; it relies on being read-only and stateless.
- The brand names were checked by web search only, which is not a trademark search.

## Licence

MIT, see `LICENSE`.
