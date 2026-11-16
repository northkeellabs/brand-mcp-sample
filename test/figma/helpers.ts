import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BRANDS = ["tarnbury", "pellmoor"] as const;
export type Flat = Record<string, { type: string | undefined; value: unknown }>;

export const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

/** Flatten a DTCG tree to { "dotted.path": { type, value } }, resolving $type inherited from parent groups. */
export function flatten(node: Record<string, any>, path: string[] = [], inherited?: string, out: Flat = {}): Flat {
  const type = node.$type ?? inherited;
  if ("$value" in node) {
    out[path.join(".")] = { type, value: node.$value };
    return out;
  }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith("$") && v && typeof v === "object") flatten(v, [...path, k], type, out);
  return out;
}

/** Every token the Figma export holds for one brand: shared base file plus the brand file. */
export function figmaTokens(brand: string): Flat {
  return { ...flatten(readJson("figma/export/base.tokens.json")), ...flatten(readJson(`figma/export/${brand}.tokens.json`)) };
}

/** Every token in tokens/: shared base folder plus the brand folder. */
export function sourceTokens(brand: string): Flat {
  const out: Flat = {};
  for (const dir of ["base", brand]) {
    for (const f of readdirSync(join("tokens", dir)).filter((n) => n.endsWith(".tokens.json")).sort()) {
      Object.assign(out, flatten(readJson(join("tokens", dir, f))));
    }
  }
  return out;
}
