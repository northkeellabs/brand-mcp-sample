// Makes the Figma export the source of the token build.
//   figma/export/base.tokens.json    -> tokens/base/figma.tokens.json
//   figma/export/<brand>.tokens.json -> tokens/<brand>/figma.tokens.json
// Two things stay hand-written because Figma Variables cannot hold them:
//   tokens/base/durations.tokens.json       (no millisecond unit among Figma variable types)
//   tokens/<brand>/type.tokens.json         (typography composites; they only reference font tokens)
// The com.figma $extensions (Figma variable ids) are dropped here: they identify a variable in one Figma file,
// they stay in figma/export for traceability, and they would otherwise end up in the DTCG JSON the server serves.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BRANDS } from "./brands.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

export function stripFigmaExtensions(node) {
  if (Array.isArray(node) || !node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$extensions") {
      const rest = Object.fromEntries(Object.entries(v).filter(([ns]) => ns !== "com.figma"));
      if (Object.keys(rest).length) out[k] = rest;
    } else out[k] = stripFigmaExtensions(v);
  }
  return out;
}

export function expected() {
  return Object.fromEntries(["base", ...BRANDS].map((name) => [name, stripFigmaExtensions(readJson(`figma/export/${name}.tokens.json`))]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [name, data] of Object.entries(expected())) {
    mkdirSync(`tokens/${name}`, { recursive: true });
    writeFileSync(`tokens/${name}/figma.tokens.json`, JSON.stringify(data, null, 2) + "\n");
    console.log(`wrote tokens/${name}/figma.tokens.json`);
  }
}
