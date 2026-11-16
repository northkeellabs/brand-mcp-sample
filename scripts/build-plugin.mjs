// Builds the Figma plugin bundle: figma/plugin/dist/code.js = export-dtcg.js + code.js (plain concatenation,
// because a Figma plugin main file is a single script with no module loader).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function bundle() {
  const exporter = readFileSync("figma/plugin/export-dtcg.js", "utf8");
  const entry = readFileSync("figma/plugin/code.js", "utf8");
  return exporter.replace(/\n*$/, "\n") + "\n" + entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync("figma/plugin/dist", { recursive: true });
  writeFileSync("figma/plugin/dist/code.js", bundle());
  console.log("figma/plugin/dist/code.js written");
}
