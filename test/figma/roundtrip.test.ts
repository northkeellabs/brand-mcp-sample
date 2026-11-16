import { describe, expect, it } from "vitest";
import { BRANDS, figmaTokens, sourceTokens } from "./helpers";

// Tokens that tokens/ holds and Figma Variables cannot express with this exporter:
// typography composites (Figma Variables have no composite type; Figma text styles are not variables)
// and durations (no millisecond unit among Figma variable types).
const NOT_IN_FIGMA = ["duration.base", "duration.fast", "type.body", "type.caption", "type.heading", "type.subheading"];

describe.each(BRANDS)("Figma export vs tokens/ round trip: %s", (brand) => {
  const figma = figmaTokens(brand);
  const source = sourceTokens(brand);

  it("the export holds 40 tokens", () => expect(Object.keys(figma)).toHaveLength(40));

  it("every Figma token exists in tokens/ with the same $type and $value", () => {
    const problems: string[] = [];
    for (const [path, f] of Object.entries(figma)) {
      const s = source[path];
      if (!s) {
        problems.push(`${path}: in the Figma export, missing from tokens/`);
        continue;
      }
      if (s.type !== f.type) problems.push(`${path}: $type figma=${f.type} tokens=${s.type}`);
      // Aliases are strings and compare as strings; colours and dimensions are objects and compare deeply.
      if (JSON.stringify(s.value) !== JSON.stringify(f.value)) problems.push(`${path}: $value figma=${JSON.stringify(f.value)} tokens=${JSON.stringify(s.value)}`);
    }
    expect(problems).toEqual([]);
  });

  it("colours agree by hex and by components", () => {
    const colours = Object.entries(figma).filter(([, t]) => t.type === "color");
    expect(colours.length).toBeGreaterThanOrEqual(14);
    for (const [path, f] of colours) {
      const s = source[path].value as any;
      const v = f.value;
      if (typeof v === "string") {
        expect(s, path).toBe(v);
      } else {
        const fv = v as any;
        expect(s.hex, path).toBe(fv.hex);
        expect(s.components, path).toEqual(fv.components);
        expect(s.alpha, path).toBe(fv.alpha);
      }
    }
  });

  it("aliases are preserved as strings in both places", () => {
    const aliases = Object.entries(figma).filter(([, t]) => typeof t.value === "string" && /^\{.+\}$/.test(t.value as string));
    expect(aliases).toHaveLength(9);
    for (const [path, f] of aliases) expect(source[path].value, path).toBe(f.value);
  });

  it("coverage: tokens/ holds exactly the expected tokens Figma does not (typography composites and durations)", () => {
    const onlyInTokens = Object.keys(source).filter((p) => !(p in figma)).sort();
    expect(onlyInTokens).toEqual(NOT_IN_FIGMA);
  });

  it("coverage: Figma holds no token that tokens/ lacks", () => {
    expect(Object.keys(figma).filter((p) => !(p in source))).toEqual([]);
  });

  it("no Figma token is an unresolved alias target", () => {
    for (const [path, f] of Object.entries(figma)) {
      if (typeof f.value === "string" && /^\{(.+)\}$/.test(f.value)) {
        const target = (f.value as string).slice(1, -1);
        expect(target in figma, `${path} -> ${target}`).toBe(true);
      }
    }
  });
});
