/** Rough colour checks for print-shop output (no colour profile: these are guides, not proofs). */

function rgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Naive RGB → CMYK in %, as a plain conversion without a profile would give. */
export function toCmyk(hex: string): [number, number, number, number] | null {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((x) => x / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const f = (x: number) => Math.round(((1 - x - k) / (1 - k)) * 100);
  return [f(r), f(g), f(b), Math.round(k * 100)];
}

export const cmykText = (hex: string) => {
  const v = toCmyk(hex);
  return v ? `C${v[0]} M${v[1]} Y${v[2]} K${v[3]}` : hex;
};

/**
 * Bright, saturated greens, blues and violets (and pure RGB primaries) lie outside what CMYK
 * inks can print and come out duller on paper.
 */
export function cmykRisk(hex: string): boolean {
  const c = rgb(hex);
  if (!c) return false;
  const [r, g, b] = c.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return false;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return s > 0.75 && l > 0.3 && l < 0.8 && ((h >= 75 && h <= 170) || (h >= 205 && h <= 300));
}
