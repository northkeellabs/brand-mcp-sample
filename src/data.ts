// Brand data and the logic behind the tools. Everything here is pure and read-only.

import { AA, contrastRatio, normalizeHex, parseHex } from "./contrast.mjs";
import { TOKENS } from "./generated/tokens";
import tarnburyColors from "../rules/tarnbury/colors.json";
import tarnburyFormats from "../rules/tarnbury/formats.json";
import pellmoorColors from "../rules/pellmoor/colors.json";
import pellmoorFormats from "../rules/pellmoor/formats.json";

export const BRANDS = ["tarnbury", "pellmoor"] as const;
export type Brand = (typeof BRANDS)[number];

export const CATEGORIES = ["color", "font", "type", "space", "spacing", "radius", "duration", "line"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CHANNELS = ["web", "social", "email", "print"] as const;
export type Channel = (typeof CHANNELS)[number];
export type TextSize = "body" | "large";

export interface ColorRules {
  brand: string;
  minContrast: { body: number; large: number };
  decorationOnly: string[];
  allowedPairs: { foreground: string; background: string; textSizes: TextSize[]; use: string }[];
}
export interface Placement {
  id: string;
  name?: string;
  width: number;
  height: number;
  unit: string;
  safeMargin: number;
  slots: { name: string; required: boolean; maxChars?: number }[];
}
export interface FormatRules {
  brand: string;
  channels: Partial<Record<Channel, Placement[]>>;
}

const COLORS: Record<Brand, ColorRules> = { tarnbury: tarnburyColors as ColorRules, pellmoor: pellmoorColors as ColorRules };
const FORMATS: Record<Brand, FormatRules> = { tarnbury: tarnburyFormats as FormatRules, pellmoor: pellmoorFormats as FormatRules };

export const NAMES: Record<Brand, string> = { tarnbury: "Tarnbury Oats", pellmoor: "Pellmoor Outdoors" };

export class ToolError extends Error {}

export const colorRules = (b: Brand): ColorRules => COLORS[b];
export const formatRules = (b: Brand): FormatRules => FORMATS[b];

/** Palette lookup: token path -> hex, plus short name -> hex ("heather"). */
export function palette(b: Brand): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TOKENS[b].list) {
    if (t.path.startsWith("color.palette.")) out[t.path] = String(t.value).toLowerCase();
  }
  return out;
}

/** Accepts "#rrggbb", "#rgb", a token path ("color.palette.heather") or a palette name ("heather"). */
export function resolveColor(b: Brand, input: string): { hex: string; token?: string } {
  const pal = palette(b);
  const key = input.trim();
  const token = key.startsWith("color.") ? key : `color.palette.${key.toLowerCase()}`;
  if (pal[token]) return { hex: pal[token], token };
  try {
    return { hex: normalizeHex(key) };
  } catch {
    throw new ToolError(`"${input}" is not a colour. Use #rrggbb, #rgb, or one of this brand's palette names: ${Object.keys(pal).map((p) => p.replace("color.palette.", "")).join(", ")}.`);
  }
}

/** Ratio truncated (never rounded up) to two decimals, as WCAG asks for threshold checks. */
export const ratio2 = (r: number): number => Math.floor(r * 100) / 100;

export function getTokens(b: Brand, category: Category | undefined, format: "dtcg" | "css") {
  const t = TOKENS[b];
  const prefix = category ? `${category}.` : "";
  const list = t.list.filter((x) => x.path.startsWith(prefix));
  if (category && !list.length) throw new ToolError(`No "${category}" tokens for ${b}.`);
  if (format === "css") {
    const names = new Set(list.map((x) => "--" + x.path.replace(/\./g, "-")));
    const lines = t.css.split("\n").filter((l) => {
      const m = /^\s*(--[a-z0-9-]+):/.exec(l);
      return m ? names.has(m[1]) : false;
    });
    return { brand: b, category: category ?? "all", format, token_count: lines.length, css: `[data-brand="${b}"] {\n${lines.join("\n")}\n}` };
  }
  const tree = category ? ((t.dtcg as Record<string, unknown>)[category] ?? {}) : t.dtcg;
  return { brand: b, category: category ?? "all", format, token_count: list.length, dtcg: category ? { [category]: tree } : tree };
}

export function getColorRules(b: Brand) {
  const r = COLORS[b];
  const pal = palette(b);
  return {
    brand: b,
    name: NAMES[b],
    min_contrast: r.minContrast,
    decoration_only: r.decorationOnly.map((p) => ({ token: p, hex: pal[p] })),
    allowed_pairs: r.allowedPairs.map((p) => ({
      foreground: { token: p.foreground, hex: pal[p.foreground] },
      background: { token: p.background, hex: pal[p.background] },
      ratio: ratio2(contrastRatio(pal[p.foreground], pal[p.background])),
      text_sizes: p.textSizes,
      use: p.use,
    })),
  };
}

export function checkContrast(b: Brand, foreground: string, background: string, textSize: TextSize) {
  const fg = resolveColor(b, foreground);
  const bg = resolveColor(b, background);
  const r = contrastRatio(fg.hex, bg.hex);
  const rules = COLORS[b];
  const brandMin = rules.minContrast[textSize];
  const pair = rules.allowedPairs.find((p) => {
    const pal = palette(b);
    return pal[p.foreground] === fg.hex && pal[p.background] === bg.hex;
  });
  const decoration = rules.decorationOnly.some((d) => palette(b)[d] === fg.hex);
  const allowed = !!pair && pair.textSizes.includes(textSize) && !decoration;
  let reason: string;
  if (decoration) reason = "The foreground is a decoration-only colour and may not carry text.";
  else if (!pair) reason = "This pair is not in the brand's allowed pairs.";
  else if (!pair.textSizes.includes(textSize)) reason = `This pair is allowed for ${pair.textSizes.join(", ")} text only.`;
  else reason = `Allowed: ${pair.use}.`;
  return {
    brand: b,
    foreground: fg.hex,
    background: bg.hex,
    text_size: textSize,
    ratio: ratio2(r),
    wcag_aa: { required: AA[textSize], pass: r >= AA[textSize] },
    brand_minimum: { required: brandMin, pass: r >= brandMin },
    allowed_by_brand_rules: allowed,
    reason,
  };
}

export function getFormat(b: Brand, channel: Channel, placement?: string) {
  const list = FORMATS[b].channels[channel];
  if (!list) throw new ToolError(`${b} has no "${channel}" channel. Available: ${Object.keys(FORMATS[b].channels).join(", ")}.`);
  if (!placement) return { brand: b, channel, placements: list };
  const found = list.find((p) => p.id === placement);
  if (!found) throw new ToolError(`${b}/${channel} has no placement "${placement}". Available: ${list.map((p) => p.id).join(", ")}.`);
  return { brand: b, channel, placements: [found] };
}

export interface Hit {
  kind: "token" | "color-pair" | "placement";
  id: string;
  summary: string;
  score: number;
}

/** Plain keyword search over tokens, colour-pair uses and placements. Every term must match. */
export function searchBrand(b: Brand, query: string, limit = 10): { brand: Brand; query: string; total: number; hits: Hit[] } {
  const terms = query.toLowerCase().split(/[^a-z0-9#.]+/).filter(Boolean);
  if (!terms.length) throw new ToolError("query needs at least one word or number.");
  const docs: { kind: Hit["kind"]; id: string; text: string; summary: string }[] = [];
  for (const t of TOKENS[b].list) {
    const v = typeof t.value === "string" ? t.value : JSON.stringify(t.value);
    docs.push({ kind: "token", id: t.path, text: `${t.path} ${t.type} ${v} ${t.description ?? ""}`, summary: `${t.path} = ${v}${t.description ? " (" + t.description + ")" : ""}` });
  }
  for (const p of COLORS[b].allowedPairs) {
    const fg = p.foreground.replace("color.palette.", "");
    const bgName = p.background.replace("color.palette.", "");
    docs.push({ kind: "color-pair", id: `${fg} on ${bgName}`, text: `${fg} ${bgName} ${p.use} ${p.textSizes.join(" ")} text pair contrast`, summary: `${fg} on ${bgName}: ${p.use} (${p.textSizes.join("/")} text)` });
  }
  for (const [channel, list] of Object.entries(FORMATS[b].channels)) {
    for (const pl of list ?? []) {
      docs.push({
        kind: "placement",
        id: `${channel}/${pl.id}`,
        text: `${channel} ${pl.id} ${pl.name ?? ""} ${pl.width} ${pl.height} ${pl.unit} ${pl.slots.map((s) => s.name).join(" ")} format size placement`,
        summary: `${channel}/${pl.id}: ${pl.width}x${pl.height} ${pl.unit}, slots: ${pl.slots.map((s) => s.name).join(", ")}`,
      });
    }
  }
  const hits = docs
    .map((d) => ({ d, text: d.text.toLowerCase() }))
    .filter(({ text }) => terms.every((t) => text.includes(t)))
    .map(({ d, text }) => ({ kind: d.kind, id: d.id, summary: d.summary, score: terms.reduce((s, t) => s + (d.id.toLowerCase().includes(t) ? 2 : 1) + (text.split(t).length - 2) * 0.1, 0) }))
    .sort((a, c) => c.score - a.score || a.id.localeCompare(c.id));
  return { brand: b, query, total: hits.length, hits: hits.slice(0, limit) };
}

export const tokensResource = (b: Brand) => JSON.stringify(TOKENS[b].dtcg, null, 2);
export const rulesResource = (b: Brand) => JSON.stringify({ colors: getColorRules(b), formats: FORMATS[b] }, null, 2);
export { parseHex };
