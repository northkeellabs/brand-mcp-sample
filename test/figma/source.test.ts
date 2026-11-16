import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expected, stripFigmaExtensions } from "../../scripts/tokens-from-figma.mjs";
import { BRANDS, flatten, readJson } from "./helpers";

describe("Figma export is the source of tokens/", () => {
  it.each(["base", ...BRANDS])("tokens/%s/figma.tokens.json is exactly what npm run tokens:from-figma writes (re-run it after a new export)", (name) => {
    expect(readJson(`tokens/${name}/figma.tokens.json`)).toEqual((expected() as Record<string, unknown>)[name]);
  });

  it("the Figma variable ids stay in figma/export and do not reach tokens/", () => {
    expect(readFileSync("figma/export/base.tokens.json", "utf8")).toContain("com.figma");
    for (const dir of ["base", ...BRANDS]) for (const f of readdirSync(`tokens/${dir}`)) expect(readFileSync(`tokens/${dir}/${f}`, "utf8"), `${dir}/${f}`).not.toContain("VariableID");
  });

  it("stripFigmaExtensions keeps other extension namespaces", () => {
    expect(stripFigmaExtensions({ a: { $value: 1, $extensions: { "com.figma": { variableId: "x" }, "com.example": { k: 1 } } }, b: { $value: 2, $extensions: { "com.figma": {} } } })).toEqual({
      a: { $value: 1, $extensions: { "com.example": { k: 1 } } },
      b: { $value: 2 },
    });
  });

  it("the only hand-written token files hold durations and typography composites, which Figma Variables cannot express", () => {
    expect(Object.keys(flatten(readJson("tokens/base/durations.tokens.json"))).sort()).toEqual(["duration.base", "duration.fast"]);
    for (const b of BRANDS) {
      expect(Object.keys(flatten(readJson(`tokens/${b}/type.tokens.json`))).sort()).toEqual(["type.body", "type.caption", "type.heading", "type.subheading"]);
    }
  });

  it("typography composites only reference font tokens", () => {
    for (const b of BRANDS) {
      const refs: string[] = [];
      JSON.stringify(readJson(`tokens/${b}/type.tokens.json`), (_k, v) => {
        if (typeof v === "string" && /^\{.+\}$/.test(v)) refs.push(v);
        return v;
      });
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(r, b).toMatch(/^\{font\.(family|size)\./);
    }
  });
});

describe("switching the source to the Figma export did not change any built CSS value", () => {
  // test/figma/fixtures/css-before-figma.json: every custom property (name -> value) of build/<brand>/tokens.css
  // as built from the hand-written tokens/ files, captured at commit 45f9703 just before the switch.
  const before = readJson("test/figma/fixtures/css-before-figma.json") as Record<string, Record<string, string>>;
  it.each(BRANDS)("%s: same custom properties, same values (order and CSS comments may differ)", (b) => {
    const css = readFileSync(`build/${b}/tokens.css`, "utf8");
    const now: Record<string, string> = {};
    for (const m of css.matchAll(/^\s+(--[\w-]+):\s*([^;]+);/gm)) now[m[1]] = m[2].trim();
    expect(now).toEqual(before[b]);
    expect(Object.keys(now)).toHaveLength(46);
  });
});
