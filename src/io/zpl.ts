import type { Project } from '../model/types';
import type { JobItem } from '../render/jobs';
import type { ResolveCtx } from '../render/resolve';
import { labelDocument } from '../render/svg';
import { svgToCanvas } from './export';

/**
 * ZPL for Zebra-compatible label printers (experimental). Each label is rendered at the printer's
 * resolution, turned into black and white and sent as one ^GFA graphic, compressed with ZPL's
 * ASCII scheme (G–Y and g–z repeat counts, "," = rest of row white, "!" = rest of row black,
 * ":" = same row as the previous one).
 */

export const ZPL_DPI = [203, 300, 600] as const;

/** Repeat count in ZPL's ASCII compression: g–z are 20…400, G–Y are 1…19. */
function count(n: number): string {
  let s = '';
  while (n > 400) { s += 'z'; n -= 400; }
  if (n >= 20) { s += String.fromCharCode(102 + Math.floor(n / 20)); n %= 20; }
  if (n > 0) s += String.fromCharCode(70 + n);
  return s;
}

/** One row of hex digits, compressed. */
function compressRow(hex: string): string {
  let end = hex.length;
  let tail = '';
  if (/0$/.test(hex)) { while (end > 0 && hex[end - 1] === '0') end--; tail = ','; }
  else if (/F$/.test(hex)) { while (end > 0 && hex[end - 1] === 'F') end--; tail = '!'; }
  // a short run at the end is cheaper written out
  if (hex.length - end < 2) { end = hex.length; tail = ''; }
  let out = '';
  for (let i = 0; i < end;) {
    let j = i + 1;
    while (j < end && hex[j] === hex[i]) j++;
    out += (j - i > 1 ? count(j - i) : '') + hex[i];
    i = j;
  }
  return out + tail;
}

const HEX = '0123456789ABCDEF';

/** Black-and-white bitmap of a canvas: 1 bit per dot, rows padded to whole bytes. */
function bitmap(c: HTMLCanvasElement, dither: boolean) {
  const w = c.width, h = c.height;
  const data = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const bpr = Math.ceil(w / 8);
  const bytes = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const black = lum[i] < 128;
      if (black) bytes[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      if (dither) {
        // Floyd–Steinberg: pass the rounding error on to the neighbours
        const err = lum[i] - (black ? 0 : 255);
        if (x + 1 < w) lum[i + 1] += (err * 7) / 16;
        if (y + 1 < h) {
          if (x > 0) lum[i + w - 1] += (err * 3) / 16;
          lum[i + w] += (err * 5) / 16;
          if (x + 1 < w) lum[i + w + 1] += err / 16;
        }
      }
    }
  }
  return { bytes, bpr, w, h };
}

/** ^GFA graphic field for a bitmap. */
export function graphicField(bytes: Uint8Array, bpr: number): string {
  const rows: string[] = [];
  let prev = '';
  for (let y = 0; y * bpr < bytes.length; y++) {
    let hex = '';
    for (let x = 0; x < bpr; x++) { const b = bytes[y * bpr + x]; hex += HEX[b >> 4] + HEX[b & 15]; }
    rows.push(hex === prev ? ':' : compressRow(hex));
    prev = hex;
  }
  return `^GFA,${bytes.length},${bytes.length},${bpr},${rows.join('')}`;
}

export interface ZplOptions { dpi: number; dither: boolean; onProgress?: (done: number, total: number) => void }

const dots = (mm: number, dpi: number) => Math.max(1, Math.round((mm / 25.4) * dpi));

/** One label at printer resolution, black and white, as a canvas (also used for the preview). */
export async function zplCanvas(p: Project, it: Pick<JobItem, 'row' | 'rowIndex' | 'seq' | 'copy' | 'design'>, o: Pick<ZplOptions, 'dpi' | 'dither'>, now = new Date()) {
  const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: it.copy, page: 1, now };
  const svg = labelDocument(p, it.design.objects, ctx, { embedFonts: true, white: true });
  const c = await svgToCanvas(svg, dots(p.paper.labelWidth, o.dpi), dots(p.paper.labelHeight, o.dpi), true);
  return { canvas: c, map: bitmap(c, o.dither) };
}

/** Black-and-white preview of what the printer will get. */
export async function zplPreview(p: Project, it: JobItem, o: Pick<ZplOptions, 'dpi' | 'dither'>): Promise<string> {
  const { canvas, map } = await zplCanvas(p, it, o);
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(map.w, map.h);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const v = map.bytes[y * map.bpr + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
      const i = (y * map.w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The whole job as one ZPL file, one ^XA…^XZ per label. */
export async function exportZpl(p: Project, items: JobItem[], o: ZplOptions): Promise<Blob> {
  const parts: string[] = [];
  const now = new Date();
  for (let i = 0; i < items.length; i++) {
    const { map } = await zplCanvas(p, items[i], o, now);
    parts.push(`^XA^PW${map.w}^LL${map.h}^LH0,0^FO0,0${graphicField(map.bytes, map.bpr)}^FS^XZ`);
    o.onProgress?.(i + 1, items.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob([parts.join('\n') + '\n'], { type: 'text/plain' });
}
