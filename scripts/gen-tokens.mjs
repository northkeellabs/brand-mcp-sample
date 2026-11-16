// One-off helper used to author the token files: turns a hex palette into DTCG 2025.10 color objects.
// Run: node scripts/gen-tokens.mjs   (writes tokens/<brand>/*.tokens.json). The committed JSON is the source of truth afterwards.
import { mkdirSync, writeFileSync } from "node:fs";

const color = (hex, description) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round((v / 255) * 10000) / 10000);
  const t = { $type: "color", $value: { colorSpace: "srgb", components: c, alpha: 1, hex: hex.toLowerCase() } };
  if (description) t.$description = description;
  return t;
};
const dim = (value, unit = "px") => ({ $type: "dimension", $value: { value, unit } });
const alias = (path, type) => ({ ...(type ? { $type: type } : {}), $value: `{${path}}` });

const brands = {
  tarnbury: {
    name: "Tarnbury Oats",
    palette: {
      oat: ["#F4EBD6", "Warm oat paper, the page background"],
      porridge: ["#4A2F1B", "Dark roasted brown, main text"],
      heather: ["#6A2C5B", "Heather purple, primary brand colour"],
      berry: ["#B5304F", "Berry red, highlights"],
      moss: ["#3E5A3B", "Field green, secondary"],
      cream: ["#FFFAF0", "Light surface for cards"],
      honey: ["#E7B03C", "Honey yellow, decoration only"],
    },
    roles: { background: "oat", surface: "cream", text: "porridge", primary: "heather", accent: "berry", support: "moss", highlight: "honey" },
    fonts: { heading: ["Georgia", "Cambria", "serif"], body: ["Trebuchet MS", "Verdana", "sans-serif"] },
    scale: [14, 16, 20, 26, 34, 46],
    headingWeight: 700,
  },
  pellmoor: {
    name: "Pellmoor Outdoors",
    palette: {
      slate: ["#1F2B33", "Deep slate, main text and dark surfaces"],
      bone: ["#F3F0E8", "Bone white page background"],
      pine: ["#2D5B4E", "Pine green, primary brand colour"],
      signal: ["#C4400F", "Signal orange, calls to action"],
      lake: ["#2F6F8F", "Lake blue, secondary"],
      sand: ["#D9CFB8", "Sand, borders and muted surfaces"],
      sun: ["#F2C230", "Sun yellow, decoration only"],
    },
    roles: { background: "bone", surface: "sand", text: "slate", primary: "pine", accent: "signal", support: "lake", highlight: "sun" },
    fonts: { heading: ["Arial Narrow", "Helvetica Neue", "sans-serif"], body: ["Segoe UI", "Helvetica", "sans-serif"] },
    scale: [13, 15, 19, 24, 32, 44],
    headingWeight: 800,
  },
};

const write = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");

write("tokens/base/base.tokens.json", {
  space: {
    $description: "Shared spacing scale used by every brand",
    $type: "dimension",
    1: dim(4), 2: dim(8), 3: dim(12), 4: dim(16), 5: dim(24), 6: dim(32), 7: dim(48), 8: dim(64),
  },
  duration: { $type: "duration", fast: { $value: { value: 120, unit: "ms" } }, base: { $value: { value: 240, unit: "ms" } } },
  font: { weight: { $type: "fontWeight", regular: { $value: 400 }, medium: { $value: 500 }, bold: { $value: 700 }, black: { $value: 800 } } },
  line: { $type: "number", tight: { $value: 1.15 }, normal: { $value: 1.5 } },
});

const sizeNames = ["xs", "sm", "md", "lg", "xl", "xxl"];
for (const [slug, b] of Object.entries(brands)) {
  mkdirSync(`tokens/${slug}`, { recursive: true });
  const pal = {};
  for (const [k, [hex, d]] of Object.entries(b.palette)) pal[k] = color(hex, d);
  write(`tokens/${slug}/color.tokens.json`, {
    color: {
      $description: `${b.name} colour tokens (invented brand, sample)`,
      palette: pal,
      role: Object.fromEntries(Object.entries(b.roles).map(([r, p]) => [r, alias(`color.palette.${p}`, "color")])),
    },
  });
  const fam = (arr) => ({ $type: "fontFamily", $value: arr });
  write(`tokens/${slug}/type.tokens.json`, {
    font: {
      family: { heading: fam(b.fonts.heading), body: fam(b.fonts.body) },
      size: Object.fromEntries(sizeNames.map((n, i) => [n, dim(b.scale[i])])),
    },
    type: {
      $type: "typography",
      heading: { $value: { fontFamily: "{font.family.heading}", fontSize: "{font.size.xxl}", fontWeight: b.headingWeight, lineHeight: 1.15 } },
      subheading: { $value: { fontFamily: "{font.family.heading}", fontSize: "{font.size.lg}", fontWeight: b.headingWeight, lineHeight: 1.25 } },
      body: { $value: { fontFamily: "{font.family.body}", fontSize: "{font.size.md}", fontWeight: 400, lineHeight: 1.5 } },
      caption: { $value: { fontFamily: "{font.family.body}", fontSize: "{font.size.xs}", fontWeight: 400, lineHeight: 1.4 } },
    },
  });
  write(`tokens/${slug}/shape.tokens.json`, {
    radius: { $type: "dimension", small: dim(b.name.startsWith("Tarnbury") ? 6 : 2), large: dim(b.name.startsWith("Tarnbury") ? 18 : 4) },
    spacing: { $type: "dimension", section: alias("space.7", "dimension"), gutter: alias("space.5", "dimension") },
  });
}
console.log("tokens written");

