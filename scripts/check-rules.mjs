// Validates rules/<brand>/colors.json and formats.json against their JSON Schemas, then checks them
// against the built tokens: every colour reference exists, no decoration colour carries text, and every
// allowed pair really meets the brand's minimum contrast for each text size it claims. Exits 1 on any problem.
import Ajv2020 from "ajv/dist/2020.js";
import { existsSync, readFileSync } from "node:fs";
import { BRANDS } from "./brands.mjs";
import { contrastRatio } from "../src/contrast.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = {
  colors: ajv.compile(readJson("rules/schema/colors.schema.json")),
  formats: ajv.compile(readJson("rules/schema/formats.schema.json")),
};

/** Returns a list of problems for one brand's rule files. Pure: used by the build and by the unit tests. */
export function checkBrandRules(brand, colors, formats, palette) {
  const problems = [];
  for (const [kind, doc] of [["colors", colors], ["formats", formats]]) {
    const v = validators[kind];
    if (!v(doc)) for (const e of v.errors) problems.push(`${brand}/${kind}.json schema: ${e.instancePath || "/"} ${e.message}`);
    else if (doc.brand !== brand) problems.push(`${brand}/${kind}.json: brand is "${doc.brand}", expected "${brand}"`);
  }
  if (problems.length) return problems; // semantic checks need a schema-valid document
  const hex = (path) => palette[path];
  for (const path of colors.decorationOnly) if (!hex(path)) problems.push(`${brand}: decorationOnly references unknown token ${path}`);
  for (const p of colors.allowedPairs) {
    const label = `${brand}: ${p.foreground} on ${p.background}`;
    if (!hex(p.foreground) || !hex(p.background)) { problems.push(`${label}: unknown colour token`); continue; }
    if (colors.decorationOnly.includes(p.foreground)) problems.push(`${label}: ${p.foreground} is decoration only and cannot carry text`);
    const ratio = contrastRatio(hex(p.foreground), hex(p.background));
    for (const size of p.textSizes) {
      if (ratio < colors.minContrast[size]) problems.push(`${label}: ratio ${ratio.toFixed(2)} is below the ${colors.minContrast[size]} this brand requires for ${size} text`);
    }
  }
  const seen = new Set();
  for (const [channel, list] of Object.entries(formats.channels)) {
    for (const pl of list) {
      const key = `${channel}/${pl.id}`;
      if (seen.has(key)) problems.push(`${brand}: duplicate placement ${key}`);
      seen.add(key);
      if (pl.safeMargin * 2 >= Math.min(pl.width, pl.height)) problems.push(`${brand}: ${key} safeMargin leaves no room`);
    }
  }
  return problems;
}

/** Palette hex by token path, read from the Style Dictionary flat output. */
export function loadPalette(brand) {
  const file = `build/${brand}/tokens.list.json`;
  if (!existsSync(file)) throw new Error(`${file} missing: run npm run build:tokens first`);
  const list = readJson(file);
  return Object.fromEntries(list.filter((t) => t.path.startsWith("color.palette.")).map((t) => [t.path, t.value]));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  let bad = 0;
  for (const brand of BRANDS) {
    const dir = process.env.RULES_DIR || "rules"; // override is for the tests only
    const problems = checkBrandRules(brand, readJson(`${dir}/${brand}/colors.json`), readJson(`${dir}/${brand}/formats.json`), loadPalette(brand));
    if (problems.length) { bad += problems.length; for (const p of problems) console.error("RULE ERROR " + p); }
    else console.log(`rules ok: ${brand}`);
  }
  if (bad) { console.error(`${bad} rule problem(s): build stopped`); process.exit(1); }
}
