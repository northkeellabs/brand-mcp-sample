// The MCP server: 5 read-only tools, 4 resources (brand://<brand>/tokens and /rules) and 1 prompt.
// Every tool takes `brand` as an enum, so an unknown brand is rejected by the zod schema before any code runs.

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  BRANDS,
  CATEGORIES,
  CHANNELS,
  NAMES,
  ToolError,
  checkContrast,
  getColorRules,
  getFormat,
  getTokens,
  rulesResource,
  searchBrand,
  tokensResource,
} from "./data";

export const SERVER_VERSION = "0.1.0";

const Brand = z.enum(BRANDS).describe(`Which brand: ${BRANDS.map((b) => `${b} (${NAMES[b]})`).join(", ")}`);
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function ok(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "brand-mcp-sample", version: SERVER_VERSION },
    {
      instructions:
        "SAMPLE server for two invented brands (tarnbury, pellmoor). Read-only. Look up design tokens, colour rules and placement formats, and check colour pairs before using them. Always pass the brand.",
    },
  );

  function tool<S extends z.ZodObject>(name: string, description: string, inputSchema: S, run: (args: z.infer<S>) => Record<string, unknown>) {
    server.registerTool(name, { description, inputSchema, annotations: READ }, ((args: z.infer<S>) => {
      try {
        return ok(run(args));
      } catch (exc) {
        if (exc instanceof ToolError) return fail(exc.message);
        return fail(`Unexpected error (${exc instanceof Error ? exc.name : "Error"}).`);
      }
    }) as never);
  }

  tool(
    "get_tokens",
    "Get a brand's design tokens. Use this when you need exact colour, font, size, spacing or radius values to write CSS or code. format 'dtcg' returns the DTCG 2025.10 JSON (aliases kept, so you can see which role points at which palette colour); format 'css' returns ready-to-paste CSS custom properties. Narrow with category to keep the answer small.",
    z.object({
      brand: Brand,
      category: z.enum(CATEGORIES).optional().describe("Token group to return. Omit for everything."),
      format: z.enum(["dtcg", "css"]).default("dtcg").describe("dtcg = DTCG 2025.10 JSON, css = CSS custom properties"),
    }),
    (a) => getTokens(a.brand, a.category, a.format),
  );

  tool(
    "get_color_rules",
    "Get a brand's colour rules: the minimum contrast ratio per text size, colours that may never carry text, and every allowed foreground/background pair with its computed ratio and intended use. Use this before choosing text and background colours for a layout.",
    z.object({ brand: Brand }),
    (a) => getColorRules(a.brand),
  );

  tool(
    "check_contrast",
    "Check one text colour on one background colour. Returns the WCAG 2.1 contrast ratio (computed, not looked up), whether it passes AA, whether it meets this brand's own minimum, and whether the brand's rules allow the pair for that text size. Use this to verify a colour choice before you use it. Colours can be #rrggbb, #rgb, or a palette name such as 'heather'.",
    z.object({
      brand: Brand,
      foreground: z.string().min(1).max(40).describe("Text colour: #rrggbb, #rgb, or a palette name"),
      background: z.string().min(1).max(40).describe("Background colour: #rrggbb, #rgb, or a palette name"),
      text_size: z.enum(["body", "large"]).describe("body = normal text; large = 24px+ or 18.66px+ bold"),
    }),
    (a) => checkContrast(a.brand, a.foreground, a.background, a.text_size),
  );

  tool(
    "get_format",
    "Get the placement formats a brand uses on a channel (web, social, email, print): size, unit, safe margin and the slots each placement has, with required flags and maximum characters. Use this when you lay out a page header, a social post or a print piece. Pass placement to get a single one.",
    z.object({
      brand: Brand,
      channel: z.enum(CHANNELS).describe("Where the piece will appear"),
      placement: z.string().max(40).optional().describe("Placement id, for example square-post. Omit to list all on the channel."),
    }),
    (a) => getFormat(a.brand, a.channel, a.placement),
  );

  tool(
    "search_brand",
    "Keyword search across one brand's tokens, colour pairs and placements. Use this when you do not know which tool or token holds what you need, for example 'primary', 'heading font' or 'story'. Every word must match. Returns up to 10 ranked hits; call a specific tool afterwards for full detail.",
    z.object({ brand: Brand, query: z.string().min(1).max(100).describe("One or more words") }),
    (a) => searchBrand(a.brand, a.query),
  );

  for (const b of BRANDS) {
    server.registerResource(
      `${b}-tokens`,
      `brand://${b}/tokens`,
      { title: `${NAMES[b]} design tokens`, description: "DTCG 2025.10 tokens (JSON)", mimeType: "application/design-tokens+json" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/design-tokens+json", text: tokensResource(b) }] }),
    );
    server.registerResource(
      `${b}-rules`,
      `brand://${b}/rules`,
      { title: `${NAMES[b]} brand rules`, description: "Colour rules and placement formats (JSON)", mimeType: "application/json" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: rulesResource(b) }] }),
    );
  }

  server.registerPrompt(
    "review_colors",
    {
      title: "Review colours against the brand",
      description: "Review the colours used in a piece of work against a brand's colour rules.",
      argsSchema: z.object({
        brand: z.enum(BRANDS).describe("Which brand to review against"),
        work: z.string().min(1).max(4000).describe("The CSS, markup or description of the colours used"),
      }),
    },
    ({ brand, work }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Review the colours in the work below against the ${NAMES[brand]} brand (brand = ${brand}).\n` +
              `1. Call get_color_rules for the allowed pairs and minimum contrast.\n` +
              `2. For each text and background colour pair in the work, call check_contrast with the right text_size.\n` +
              `3. Report each pair as pass or fail with the ratio, name any decoration-only colour used for text, and suggest an allowed pair for each failure.\n\n` +
              `Work to review:\n${work}`,
          },
        },
      ],
    }),
  );

  return server;
}
