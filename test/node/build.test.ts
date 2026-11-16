import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBrandRules, loadPalette } from "../../scripts/check-rules.mjs";
import { contrastRatio, normalizeHex } from "../../src/contrast.mjs";

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const BRANDS = ["tarnbury", "pellmoor"];
const good = (b: string) => ({ colors: readJson(`rules/${b}/colors.json`), formats: readJson(`rules/${b}/formats.json`), palette: loadPalette(b) });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("contrast math", () => {
  it("black on white is 21", () => expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10));
  it("#767676 on white is about 4.54", () => expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2));
  it("is symmetric and 1 for identical colours", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 10);
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 10);
  });
  it("accepts #rgb shorthand", () => expect(normalizeHex("#F0a")).toBe("#ff00aa"));
  it("rejects a bad colour", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow();
    expect(() => contrastRatio("#12345", "#fff")).toThrow();
  });
});

describe("token build output (Style Dictionary v5, DTCG 2025.10)", () => {
  it.each(BRANDS)("%s: every colour token is a valid 2025.10 colour object", (b) => {
    const files = ["figma"].map((f) => readJson(`tokens/${b}/${f}.tokens.json`));
    const palette = files[0].color.palette;
    expect(Object.keys(palette).length).toBeGreaterThanOrEqual(6);
    for (const [name, t] of Object.entries<any>(palette)) {
      expect(t.$type, name).toBe("color");
      expect(t.$value.colorSpace, name).toBe("srgb");
      expect(t.$value.components, name).toHaveLength(3);
      for (const c of t.$value.components) expect(c >= 0 && c <= 1, `${name} component range`).toBe(true);
      const n = t.$value.components.map((c: number) => Math.round(c * 255));
      expect(t.$value.hex, name).toBe("#" + n.map((v: number) => v.toString(16).padStart(2, "0")).join(""));
    }
  });
  it.each(BRANDS)("%s: dimensions use the 2025.10 {value, unit} object", (b) => {
    const t = readJson(`tokens/${b}/figma.tokens.json`);
    expect(t.font.size.md.$value).toEqual({ value: expect.any(Number), unit: "px" });
  });
  it.each(BRANDS)("%s: CSS has scoped custom properties and no unresolved aliases", (b) => {
    const css = readFileSync(`build/${b}/tokens.css`, "utf8");
    expect(css).toContain(`[data-brand="${b}"] {`);
    expect(css).toMatch(/--color-role-primary: #[0-9a-f]{6};/);
    expect(css).toMatch(/--space-4: 16px;/);
    expect(css).not.toMatch(/\{[a-z.]+\}/);
  });
  it("the two brands build to different primaries from the same shared base", () => {
    const a = readFileSync("build/tarnbury/tokens.css", "utf8");
    const p = readFileSync("build/pellmoor/tokens.css", "utf8");
    expect(a.match(/--color-role-primary: (#[0-9a-f]{6})/)![1]).not.toBe(p.match(/--color-role-primary: (#[0-9a-f]{6})/)![1]);
    expect(a.match(/--space-6: ([^;]+);/)![1]).toBe(p.match(/--space-6: ([^;]+);/)![1]);
  });
  it("typography composites resolve to CSS shorthand", () => {
    expect(readFileSync("build/tarnbury/tokens.css", "utf8")).toContain("--type-heading: 700 46px/1.15 Georgia, Cambria, serif;");
  });
  it("the generated module holds both brands", async () => {
    const { TOKENS } = await import("../../src/generated/tokens");
    expect(Object.keys(TOKENS)).toEqual(BRANDS);
    expect(TOKENS.tarnbury.list.find((t: any) => t.path === "color.role.primary")?.value).toBe("#6a2c5b");
  });
});

describe("brand rules: schema and checks", () => {
  it.each(BRANDS)("%s: shipped rules pass", (b) => {
    const g = good(b);
    expect(checkBrandRules(b, g.colors, g.formats, g.palette)).toEqual([]);
  });
  it("schema rejects a minimum contrast looser than AA", () => {
    const g = good("tarnbury");
    const c = clone(g.colors);
    c.minContrast.body = 4;
    const p = checkBrandRules("tarnbury", c, g.formats, g.palette);
    expect(p.join("\n")).toContain("minContrast/body");
  });
  it("schema rejects a missing field and an unknown field", () => {
    const g = good("tarnbury");
    const c = clone(g.colors);
    delete c.allowedPairs[0].use;
    c.surprise = 1;
    const out = checkBrandRules("tarnbury", c, g.formats, g.palette).join("\n");
    expect(out).toContain("must have required property 'use'");
    expect(out).toContain("additional properties");
  });
  it("schema rejects a bad text size and a bad colour path", () => {
    const g = good("pellmoor");
    const c = clone(g.colors);
    c.allowedPairs[0].textSizes = ["huge"];
    c.allowedPairs[1].foreground = "#ffffff";
    const out = checkBrandRules("pellmoor", c, g.formats, g.palette).join("\n");
    expect(out).toContain("allowedPairs/0/textSizes");
    expect(out).toContain("allowedPairs/1/foreground");
  });
  it("fails a pair whose real contrast is below the brand minimum", () => {
    const g = good("pellmoor");
    const c = clone(g.colors);
    c.allowedPairs.push({ foreground: "color.palette.bone", background: "color.palette.pine", textSizes: ["body"], use: "bad" });
    const out = checkBrandRules("pellmoor", c, g.formats, g.palette).join("\n");
    expect(out).toContain("below the 7 this brand requires for body text");
  });
  it("fails an unknown colour token and a decoration colour used for text", () => {
    const g = good("tarnbury");
    const c = clone(g.colors);
    c.allowedPairs.push({ foreground: "color.palette.nothere", background: "color.palette.oat", textSizes: ["large"], use: "test use" });
    c.allowedPairs.push({ foreground: "color.palette.honey", background: "color.palette.porridge", textSizes: ["large"], use: "test use" });
    const out = checkBrandRules("tarnbury", c, g.formats, g.palette).join("\n");
    expect(out).toContain("unknown colour token");
    expect(out).toContain("decoration only");
  });
  it("fails a rule file filed under the wrong brand", () => {
    const g = good("tarnbury");
    expect(checkBrandRules("pellmoor", g.colors, g.formats, g.palette).join("\n")).toContain('brand is "tarnbury", expected "pellmoor"');
  });
  it("formats: rejects a bad unit, a bad slot name and an oversized safe margin", () => {
    const g = good("tarnbury");
    const f = clone(g.formats);
    f.channels.web[0].unit = "em";
    f.channels.web[1].slots[0].name = "ad";
    const out = checkBrandRules("tarnbury", g.colors, f, g.palette).join("\n");
    expect(out).toContain("unit");
    expect(out).toContain("slots/0/name");
    const f2 = clone(g.formats);
    f2.channels.email[0].safeMargin = 200;
    expect(checkBrandRules("tarnbury", g.colors, f2, g.palette).join("\n")).toContain("safeMargin leaves no room");
  });
  it("formats: rejects duplicate placement ids and an unknown channel", () => {
    const g = good("tarnbury");
    const f = clone(g.formats);
    f.channels.web.push(clone(f.channels.web[0]));
    expect(checkBrandRules("tarnbury", g.colors, f, g.palette).join("\n")).toContain("duplicate placement web/hero");
    const f2 = clone(g.formats);
    f2.channels.billboard = f2.channels.web;
    expect(checkBrandRules("tarnbury", g.colors, f2, g.palette).length).toBeGreaterThan(0);
  });
  it("the build step exits 1 and names the problem when a rule file is bad", () => {
    const dir = mkdtempSync(join(tmpdir(), "rules-"));
    cpSync("rules", dir, { recursive: true });
    const c = readJson(`${dir}/pellmoor/colors.json`);
    c.allowedPairs.push({ foreground: "color.palette.bone", background: "color.palette.pine", textSizes: ["body"], use: "bad pair" });
    writeFileSync(`${dir}/pellmoor/colors.json`, JSON.stringify(c));
    const r = spawnSync(process.execPath, ["scripts/check-rules.mjs"], { env: { ...process.env, RULES_DIR: dir }, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("RULE ERROR pellmoor");
    expect(r.stderr).toContain("build stopped");
  });
});
