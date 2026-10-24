import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import JSZip from 'jszip';
import { t } from '../i18n';
import type { LabelObject, Project } from '../model/types';
import { paginate, type JobItem, type Page } from '../render/jobs';
import { resolveTemplate, type ResolveCtx } from '../render/resolve';
import { fontFaceCss, labelDocument, labelMarkup, sheetDocument, sheetLayout, testPageDocument, type RasterPatch, type SheetCell, type SheetOpts } from '../render/svg';

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim() || 'label';

/* ---------- rasterization ---------- */

export async function svgToCanvas(svg: string, wPx: number, hPx: number, white = false): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error(t('SVG 렌더링 실패'))); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(wPx));
    c.height = Math.max(1, Math.round(hPx));
    const g = c.getContext('2d')!;
    if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const mmToPx = (mm: number, dpi: number) => (mm / 25.4) * dpi;
const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res) => c.toBlob((b) => res(b!), type, q));

/* ---------- browser print (vector, uses installed fonts) ---------- */

export function printPages(p: Project, pages: Page[], o: SheetOpts) {
  const L = sheetLayout(p.paper, o.fold);
  printSvgs(L.width, L.height, pages.map((pg, i) => sheetDocument(p, pg.cells, { ...o, mirror: pg.back ? o.mirror : 'none' }, i)));
}

export function printTestPage(p: Project, o: Pick<SheetOpts, 'cropMarks' | 'markLabels' | 'testPoints'> = {}) {
  printSvgs(p.paper.width, p.paper.height, [testPageDocument(p, o)]);
}

function printSvgs(W: number, H: number, svgs: string[]) {
  document.getElementById('print-root')?.remove();
  document.getElementById('print-style')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = svgs.map((svg) => `<div class="print-page">${svg}</div>`).join('');
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `@page{size:${W}mm ${H}mm;margin:0}
@media print{body>*:not(#print-root){display:none!important}#print-root{display:block!important}
.print-page{width:${W}mm;height:${H}mm;overflow:hidden;page-break-after:always;break-after:page}
.print-page:last-child{page-break-after:auto;break-after:auto}.print-page>svg{display:block;width:100%;height:100%}}
@media screen{#print-root{display:none}}`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => { root.remove(); style.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}

/* ---------- PDF ---------- */

export interface PdfOptions { mode: 'vector' | 'raster'; dpi: number; sheet: SheetOpts; onProgress?: (done: number, total: number) => void }

const firstFamily = (css: string) => css.split(',')[0].trim().replace(/^["']|["']$/g, '');

function ttfFamilies(p: Project): Set<string> {
  const s = new Set<string>();
  for (const f of p.fonts) {
    const head = atob(f.data.slice(0, 8));
    if (head.startsWith('\x00\x01\x00\x00') || head.startsWith('true')) s.add(f.family);
  }
  return s;
}

function needsRaster(o: LabelObject, ttf: Set<string>): boolean {
  if (o.hidden) return false;
  switch (o.type) {
    case 'text':
      return !ttf.has(firstFamily(o.fontFamily)) || o.bold || o.italic || o.fill.type !== 'solid' ||
        !!o.effects.shadow || !!o.effects.outline || o.letterSpacing !== 0;
    case 'rect': case 'ellipse': case 'triangle': case 'line':
      return !!o.effects.shadow && o.effects.shadow.blur > 0;
    case 'table':
      return !ttf.has(firstFamily(o.fontFamily)) || o.headerRow || o.headerCol || Object.values(o.styles).some((s) => s.bold);
    default: return false;
  }
}

/** Axis-aligned bounds of an object (with generous padding for effects and overflow), limited to the label plus bleed. */
function bounds(o: LabelObject, labelW: number, labelH: number, bleed: number) {
  const r = (o.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const bw = o.w * c + o.h * s, bh = o.w * s + o.h * c;
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  let pad = 1.5;
  if ('effects' in o) {
    const sh = o.effects.shadow, ol = o.effects.outline;
    if (sh) pad += Math.abs(sh.dx) + Math.abs(sh.dy) + sh.blur * 2;
    if (ol) pad += ol.width + (ol.double ? ol.width2 : 0);
  }
  if (o.type === 'text' && o.fit === 'none') pad += o.w; // text may overflow its box
  const e = Math.max(0, bleed) + 2;
  const x0 = Math.max(-e, cx - bw / 2 - pad), y0 = Math.max(-e, cy - bh / 2 - pad);
  const x1 = Math.min(labelW + e, cx + bw / 2 + pad), y1 = Math.min(labelH + e, cy + bh / 2 + pad);
  return { x: x0, y: y0, w: Math.max(0.1, x1 - x0), h: Math.max(0.1, y1 - y0) };
}

async function rasterPatches(p: Project, objects: LabelObject[], ctx: ResolveCtx, ttf: Set<string>, dpi: number) {
  const map = new Map<string, RasterPatch>();
  const css = p.fonts.length ? `<style>${fontFaceCss(p)}</style>` : '';
  for (const o of objects) {
    if (!needsRaster(o, ttf)) continue;
    const b = bounds(o, p.paper.labelWidth, p.paper.labelHeight, p.paper.bleed);
    const markup = labelMarkup(p, [o], ctx, { paperBg: false, idp: 'r' });
    if (!markup.includes('<')) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}mm" height="${b.h}mm" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">${css}${markup}</svg>`;
    const canvas = await svgToCanvas(svg, mmToPx(b.w, dpi), mmToPx(b.h, dpi));
    map.set(o.id, { href: canvas.toDataURL('image/png'), ...b });
  }
  return map;
}

export async function exportPdf(p: Project, pages: Page[], o: PdfOptions): Promise<Blob> {
  const { width: W, height: H } = sheetLayout(p.paper, o.sheet.fold);
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
  const ttf = ttfFamilies(p);
  if (o.mode === 'vector') {
    for (const f of p.fonts) {
      if (!ttf.has(f.family)) continue;
      doc.addFileToVFS(`${f.family}.ttf`, f.data);
      doc.addFont(`${f.family}.ttf`, f.family, 'normal');
    }
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage([W, H], W > H ? 'landscape' : 'portrait');
      const pg = pages[i];
      const sheetOpts = { ...o.sheet, mirror: pg.back ? o.sheet.mirror : 'none' as const };
      if (o.mode === 'raster') {
        const svg = sheetDocument(p, pg.cells, { ...sheetOpts, embedFonts: true }, i);
        const c = await svgToCanvas(svg, mmToPx(W, o.dpi), mmToPx(H, o.dpi), true);
        doc.addImage(c, 'PNG', 0, 0, W, H, undefined, 'FAST');
      } else {
        const withRaster = async (c: SheetCell) => ({ ...c, raster: await rasterPatches(p, c.objects, c.ctx, ttf, o.dpi) });
        const cells: (SheetCell | null)[] = [];
        for (const cell of pg.cells) {
          cells.push(cell ? { ...(await withRaster(cell)), back: cell.back ? await withRaster(cell.back) : cell.back } : null);
        }
        host.innerHTML = sheetDocument(p, cells, sheetOpts, i);
        const el = host.firstElementChild as SVGSVGElement;
        await doc.svg(el, { x: 0, y: 0, width: W, height: H });
      }
      o.onProgress?.(i + 1, pages.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    host.remove();
  }
  return doc.output('blob');
}

/* ---------- PNG per label ---------- */

export async function exportPngZip(p: Project, items: JobItem[], o: { dpi: number; nameTpl: string; white: boolean; onProgress?: (d: number, t: number) => void }): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  const now = new Date();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: it.copy, page: 1, now };
    const svg = labelDocument(p, it.design.objects, ctx, { embedFonts: true, white: o.white });
    const c = await svgToCanvas(svg, mmToPx(p.paper.labelWidth, o.dpi), mmToPx(p.paper.labelHeight, o.dpi), o.white);
    let name = safeName(resolveTemplate(o.nameTpl || '{{#seq:0000}}', ctx));
    const k = used.get(name) ?? 0;
    used.set(name, k + 1);
    if (k) name += `_${k + 1}`;
    zip.file(`${name}.png`, await toBlob(c));
    o.onProgress?.(i + 1, items.length);
  }
  return zip.generateAsync({ type: 'blob' });
}

/** One PDF per distinct value of `column`, zipped. */
export async function exportSplitPdfZip(p: Project, items: JobItem[], column: string, o: PdfOptions & { startCell: number; duplex: boolean }): Promise<Blob> {
  const fold = o.sheet.fold;
  const groups = new Map<string, JobItem[]>();
  for (const it of items) {
    const key = it.row?.values[column]?.trim() || t('(빈 값)');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const zip = new JSZip();
  let done = 0;
  for (const [key, list] of groups) {
    const pages = paginate(p, list, { startCell: 1, duplex: o.duplex && !fold, fold });
    const blob = await exportPdf(p, pages, { ...o, onProgress: undefined });
    zip.file(`${safeName(key)}.pdf`, blob);
    o.onProgress?.(++done, groups.size);
  }
  return zip.generateAsync({ type: 'blob' });
}
