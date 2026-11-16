import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { bundle } from "../../scripts/build-plugin.mjs";

const require = createRequire(import.meta.url);
const { exportDtcg } = require("../../figma/plugin/export-dtcg.js") as { exportDtcg: (api: unknown) => Promise<Record<string, any>> };

// ---- a mocked figma.variables API: only the two read calls the exporter uses ----
type Mode = { modeId: string; name: string };
type Coll = { id: string; name: string; modes: Mode[] };
type Vari = { id: string; name: string; resolvedType: string; scopes: string[]; description?: string; variableCollectionId: string; valuesByMode: Record<string, unknown> };
const mockApi = (collections: Coll[], variables: Vari[]) => ({
  variables: {
    getLocalVariableCollectionsAsync: async () => collections,
    getLocalVariablesAsync: async () => variables,
  },
});

const rgb = (hex: string, a = 1) => ({
  r: Math.fround(parseInt(hex.slice(1, 3), 16) / 255),
  g: Math.fround(parseInt(hex.slice(3, 5), 16) / 255),
  b: Math.fround(parseInt(hex.slice(5, 7), 16) / 255),
  a: Math.fround(a),
});
const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });

let n = 0;
const v = (collection: string, name: string, resolvedType: string, scopes: string[], valuesByMode: Record<string, unknown>, description?: string): Vari => ({
  id: `VariableID:t:${++n}`,
  name,
  resolvedType,
  scopes,
  variableCollectionId: collection,
  valuesByMode,
  ...(description ? { description } : {}),
});

// Shared primitives (one mode), as on a Starter plan.
function primitives() {
  const P = "C:prim";
  const mode = "P0";
  const collection: Coll = { id: P, name: "Primitives", modes: [{ modeId: mode, name: "Mode 1" }] };
  const space4 = v(P, "space/4", "FLOAT", ["GAP", "WIDTH_HEIGHT"], { [mode]: 16 }, "Base spacing");
  const bold = v(P, "font/weight/bold", "FLOAT", ["FONT_WEIGHT"], { [mode]: 700 });
  const tight = v(P, "line/tight", "FLOAT", ["LINE_HEIGHT"], { [mode]: Math.fround(1.15) });
  const oat = v(P, "tarnbury/color/palette/oat", "COLOR", ["ALL_FILLS"], { [mode]: rgb("#f4ebd6") }, "Warm oat paper");
  const slate = v(P, "pellmoor/color/palette/slate", "COLOR", ["ALL_FILLS"], { [mode]: rgb("#2b3a42") });
  return { collection, vars: { space4, bold, tight, oat, slate } };
}

// Layout A: one "Brand: <Name>" collection per brand, one mode each (works on every plan).
function layoutA() {
  const p = primitives();
  const mk = (id: string, name: string, bg: Vari, family: string, size: number) => {
    const m = `${id}0`;
    const collection: Coll = { id, name: `Brand: ${name}`, modes: [{ modeId: m, name: "Mode 1" }] };
    return {
      collection,
      vars: [
        v(id, "color/role/background", "COLOR", ["ALL_FILLS"], { [m]: alias(bg.id) }),
        v(id, "spacing/gutter", "FLOAT", ["GAP"], { [m]: alias(p.vars.space4.id) }),
        v(id, "font/family/heading", "STRING", ["FONT_FAMILY"], { [m]: family }),
        v(id, "font/size/md", "FLOAT", ["FONT_SIZE"], { [m]: size }),
      ],
    };
  };
  const t = mk("C:tarn", "Tarnbury", p.vars.oat, "Georgia, Cambria , serif,", 20);
  const l = mk("C:pell", "Pellmoor", p.vars.slate, "Inter, system-ui, sans-serif", 18);
  return mockApi([p.collection, t.collection, l.collection], [...Object.values(p.vars), ...t.vars, ...l.vars]);
}

// Layout B: one "Brand" collection with one mode per brand (needs a plan with several modes).
function layoutB() {
  const p = primitives();
  const C = "C:brand";
  const T = "B-T";
  const L = "B-L";
  const collection: Coll = { id: C, name: "Brand", modes: [{ modeId: T, name: "Tarnbury" }, { modeId: L, name: "Pellmoor" }] };
  const vars = [
    v(C, "color/role/background", "COLOR", ["ALL_FILLS"], { [T]: alias(p.vars.oat.id), [L]: alias(p.vars.slate.id) }),
    v(C, "spacing/gutter", "FLOAT", ["GAP"], { [T]: alias(p.vars.space4.id), [L]: alias(p.vars.space4.id) }),
    v(C, "font/family/heading", "STRING", ["FONT_FAMILY"], { [T]: "Georgia, Cambria , serif,", [L]: "Inter, system-ui, sans-serif" }),
    v(C, "font/size/md", "FLOAT", ["FONT_SIZE"], { [T]: 20, [L]: 18 }),
  ];
  return mockApi([p.collection, collection], [...Object.values(p.vars), ...vars]);
}

const stripIds = (x: any): any => {
  if (Array.isArray(x)) return x.map(stripIds);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([k]) => k !== "$extensions").map(([k, val]) => [k, stripIds(val)]));
  return x;
};

describe("exportDtcg with a mocked figma.variables API", () => {
  it("float32 1.149999976158142 becomes 1.15", async () => {
    expect(Math.fround(1.15)).toBe(1.149999976158142);
    const files = await exportDtcg(layoutA());
    expect(files.base.line.tight).toMatchObject({ $type: "number", $value: 1.15 });
  });

  it("an alias to a primitive becomes {color.palette.x} with the brand prefix stripped", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.tarnbury.color.role.background.$value).toBe("{color.palette.oat}");
    expect(files.pellmoor.color.role.background.$value).toBe("{color.palette.slate}");
    // the brand prefix is not a level in the output tree
    expect(files.tarnbury.tarnbury).toBeUndefined();
    expect(files.tarnbury.color.palette.oat.$type).toBe("color");
  });

  it("an alias to a shared (unprefixed) primitive keeps its path", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.tarnbury.spacing.gutter).toMatchObject({ $type: "dimension", $value: "{space.4}" });
  });

  it("the FONT_WEIGHT scope gives fontWeight (a bare number)", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.base.font.weight.bold).toMatchObject({ $type: "fontWeight", $value: 700 });
  });

  it("a FONT_FAMILY string becomes an array, trimmed, with empty entries dropped", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.tarnbury.font.family.heading).toMatchObject({ $type: "fontFamily", $value: ["Georgia", "Cambria", "serif"] });
  });

  it("a colour is an srgb colour object with components (4 decimals), alpha and hex", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.tarnbury.color.palette.oat.$value).toEqual({ colorSpace: "srgb", components: [0.9569, 0.9216, 0.8392], alpha: 1, hex: "#f4ebd6" });
  });

  it("colour alpha (a float32) is rounded to 4 decimals", async () => {
    const api = layoutA();
    const vars = await api.variables.getLocalVariablesAsync();
    vars.find((x) => x.name === "tarnbury/color/palette/oat")!.valuesByMode.P0 = rgb("#000000", 0.3);
    const files = await exportDtcg(api);
    expect(files.tarnbury.color.palette.oat.$value.alpha).toBe(0.3);
  });

  it("a plain FLOAT is a px dimension; description and Figma variable id are carried over", async () => {
    const files = await exportDtcg(layoutA());
    expect(files.base.space["4"]).toMatchObject({ $type: "dimension", $value: { value: 16, unit: "px" }, $description: "Base spacing" });
    expect(files.base.space["4"].$extensions["com.figma"].variableId).toMatch(/^VariableID:/);
    expect(files.tarnbury.font.size.md.$value).toEqual({ value: 20, unit: "px" });
  });

  it("both brand layouts (Brand: X collections, and one Brand collection with modes) give the same files", async () => {
    const a = await exportDtcg(layoutA());
    const b = await exportDtcg(layoutB());
    expect(Object.keys(a).sort()).toEqual(["base", "pellmoor", "tarnbury"]);
    expect(Object.keys(b).sort()).toEqual(["base", "pellmoor", "tarnbury"]);
    // variable ids differ between the layouts by construction; everything else must be identical
    expect(stripIds(b)).toEqual(stripIds(a));
    expect(b.pellmoor.font.family.heading.$value).toEqual(["Inter", "system-ui", "sans-serif"]);
    expect(b.pellmoor.color.role.background.$value).toBe("{color.palette.slate}");
  });
});

describe("plugin bundle", () => {
  it("figma/plugin/dist/code.js is exactly export-dtcg.js followed by code.js (run npm run build:plugin)", () => {
    expect(readFileSync("figma/plugin/dist/code.js", "utf8")).toBe(bundle());
  });
  it("the manifest points at the bundle", () => {
    expect(JSON.parse(readFileSync("figma/plugin/manifest.json", "utf8")).main).toBe("dist/code.js");
  });
  it("the bundle runs in a bare sandbox (no module, no require) and calls showUI", () => {
    const calls: string[] = [];
    const figma = {
      showUI: () => calls.push("showUI"),
      ui: { postMessage: () => calls.push("post") },
      variables: { getLocalVariableCollectionsAsync: async () => [], getLocalVariablesAsync: async () => [] },
    };
    new Function("figma", "__html__", bundle())(figma, "<html></html>");
    expect(calls).toContain("showUI");
  });
});
