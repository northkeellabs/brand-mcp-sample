// WCAG 2.1 contrast math. Plain ESM so build scripts, the Worker and tests share one implementation.

/** Parse #rgb or #rrggbb into [r,g,b] 0-255. Throws on anything else. */
export function parseHex(hex) {
  if (typeof hex !== "string") throw new Error("colour must be a string");
  let h = hex.trim().toLowerCase();
  if (!h.startsWith("#")) throw new Error(`colour must be a hex value like #1a2b3c, got "${hex}"`);
  h = h.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`colour must be #rgb or #rrggbb, got "${hex}"`);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1 to 21 (unrounded). */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG 2.1 AA thresholds: 4.5 for body text, 3 for large text. */
export const AA = { body: 4.5, large: 3 };

export function normalizeHex(hex) {
  return "#" + parseHex(hex).map((v) => v.toString(16).padStart(2, "0")).join("");
}
