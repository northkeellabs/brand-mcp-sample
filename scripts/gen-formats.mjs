// One-off helper that authored rules/<brand>/formats.json. The committed JSON is the source of truth.
import { writeFileSync } from "node:fs";
const S = (name, required, maxChars) => ({ name, required, ...(maxChars ? { maxChars } : {}) });
const P = (id, name, width, height, unit, safeMargin, slots) => ({ id, name, width, height, unit, safeMargin, slots });
const out = {
  tarnbury: { brand: "tarnbury", channels: {
    web: [P("hero", "Home page hero", 1600, 600, "px", 48, [S("headline", true, 60), S("subline", false, 120), S("logo", true), S("image", true)]),
          P("strip", "Header strip", 1200, 200, "px", 24, [S("headline", true, 40), S("logo", true)])],
    social: [P("square-post", "Square post", 1080, 1080, "px", 72, [S("headline", true, 50), S("logo", true), S("image", true)]),
             P("story", "Vertical story", 1080, 1920, "px", 120, [S("headline", true, 40), S("call-to-action", false, 24), S("logo", true)])],
    email: [P("header", "Email header", 600, 200, "px", 20, [S("headline", true, 45), S("logo", true)])],
    print: [P("shelf-card", "Shelf card", 100, 150, "mm", 6, [S("headline", true, 30), S("subline", false, 60), S("logo", true)])] } },
  pellmoor: { brand: "pellmoor", channels: {
    web: [P("hero", "Home page hero", 1920, 720, "px", 64, [S("headline", true, 50), S("call-to-action", true, 20), S("logo", true), S("image", true)]),
          P("card", "Product card", 800, 600, "px", 32, [S("headline", true, 36), S("image", true)])],
    social: [P("square-post", "Square post", 1080, 1080, "px", 80, [S("headline", true, 45), S("logo", true), S("image", true)]),
             P("landscape-post", "Landscape post", 1200, 628, "px", 56, [S("headline", true, 55), S("logo", true), S("image", true)])],
    email: [P("header", "Email header", 640, 180, "px", 20, [S("headline", true, 40), S("logo", true)])],
    print: [P("trail-sign", "Trail sign", 297, 420, "mm", 15, [S("headline", true, 40), S("subline", false, 100), S("logo", true)])] } },
};
for (const [b, v] of Object.entries(out)) writeFileSync(`rules/${b}/formats.json`, JSON.stringify(v, null, 2) + "\n");
