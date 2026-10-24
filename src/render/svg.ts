import { cellKey, cellSpans, tableGeometry } from '../model/table';
import type { BarcodeObj, Fill, ImageObj, LabelObject, Paper, Project, QrObj, ShapeObj, SvgObj, TableObj, TextObj } from '../model/types';
import { barcodeSvg, code2dSvg } from './barcode';
import { resolveObject, resolveTemplate, type ResolveCtx } from './resolve';
import { layoutText } from './text';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export interface RasterPatch { href: string; x: number; y: number; w: number; h: number }

export interface RenderOpts {
  /** unique prefix for gradient/clip ids when several labels share one document */
  idp?: string;
  /** editor mode: objects hidden by data are drawn faintly, barcode errors are annotated */
  editor?: boolean;
  /** include label colour and background image */
  paperBg?: boolean;
  /** forced raster substitutes (vector PDF fallback) */
  raster?: Map<string, RasterPatch>;
  /** render only these object ids */
  only?: Set<string>;
}

interface Acc { defs: string[]; idp: string }

function paint(f: Fill, key: string, acc: Acc): string {
  switch (f.type) {
    case 'none': return 'none';
    case 'solid': return f.color;
    case 'linear': {
      const id = `${acc.idp}g${key}`;
      const a = (f.angle * Math.PI) / 180;
      const x = Math.cos(a) / 2, y = Math.sin(a) / 2;
      acc.defs.push(`<linearGradient id="${id}" x1="${n(0.5 - x)}" y1="${n(0.5 - y)}" x2="${n(0.5 + x)}" y2="${n(0.5 + y)}">${stops(f.stops)}</linearGradient>`);
      return `url(#${id})`;
    }
    case 'radial': {
      const id = `${acc.idp}g${key}`;
      acc.defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops(f.stops)}</radialGradient>`);
      return `url(#${id})`;
    }
  }
}
const stops = (s: { offset: number; color: string }[]) =>
  s.map((x) => `<stop offset="${n(x.offset)}" stop-color="${x.color}"/>`).join('');

/* ---------- per type ---------- */

function textMarkup(o: TextObj, content: string, acc: Acc, override?: string): string {
  if (!content) return '';
  const L = layoutText(o, content);
  const fill = override ?? paint(o.fill, o.id, acc);
  const total = (L.lines.length - 1) * L.lineAdvance + L.ascent + L.descent;
  const top = o.vAlign === 'top' ? 0 : o.vAlign === 'bottom' ? o.h - total : (o.h - total) / 2;
  const fam = esc(o.fontFamily);
  const common = `font-family="${fam}" font-size="${n(L.sizeMm)}" font-weight="${o.bold ? 700 : 400}"${o.italic ? ' font-style="italic"' : ''}${o.letterSpacing ? ` letter-spacing="${n(o.letterSpacing)}"` : ''} xml:space="preserve"`;
  const out: string[] = [];
  const ol = o.effects.outline;
  L.lines.forEach((ln, i) => {
    const x = o.align === 'left' ? 0 : o.align === 'right' ? o.w - ln.width : (o.w - ln.width) / 2;
    const y = top + L.ascent + i * L.lineAdvance;
    const t = esc(ln.text);
    const tx = L.scaleX !== 1 ? `<g transform="translate(${n(x)} 0) scale(${n(L.scaleX)} 1)">` : '';
    const px = L.scaleX !== 1 ? 0 : x;
    const layers: string[] = [];
    if (ol && !override) {
      if (ol.double) layers.push(`<text x="${n(px)}" y="${n(y)}" ${common} fill="${ol.color2}" stroke="${ol.color2}" stroke-width="${n((ol.width + ol.width2) * 2)}" stroke-linejoin="round">${t}</text>`);
      layers.push(`<text x="${n(px)}" y="${n(y)}" ${common} fill="${ol.color}" stroke="${ol.color}" stroke-width="${n(ol.width * 2)}" stroke-linejoin="round">${t}</text>`);
    }
    layers.push(`<text x="${n(px)}" y="${n(y)}" ${common} fill="${fill}">${t}</text>`);
    if (o.underline) {
      const uy = y + L.sizeMm * 0.12;
      layers.push(`<rect x="${n(px)}" y="${n(uy)}" width="${n(ln.width / L.scaleX)}" height="${n(L.sizeMm * 0.06)}" fill="${fill}"/>`);
    }
    out.push(tx ? tx + layers.join('') + '</g>' : layers.join(''));
  });
  return out.join('');
}

function shapeMarkup(o: ShapeObj, acc: Acc, override?: string): string {
  const fill = override ?? paint(o.fill, o.id, acc);
  const stroke = override ?? (o.strokeWidth > 0 ? o.stroke : 'none');
  const sw = o.strokeWidth;
  const dash = o.dash && sw > 0 ? ` stroke-dasharray="${n(sw * 3)} ${n(sw * 2)}"` : '';
  const st = `fill="${o.type === 'line' ? 'none' : fill}" stroke="${stroke}" stroke-width="${n(sw)}"${dash}`;
  const i = o.type === 'line' ? 0 : sw / 2; // keep stroke inside the box
  switch (o.type) {
    case 'rect':
      return `<rect x="${n(i)}" y="${n(i)}" width="${n(Math.max(0, o.w - sw))}" height="${n(Math.max(0, o.h - sw))}" rx="${n(o.cornerRadius)}" ${st}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(o.w / 2)}" cy="${n(o.h / 2)}" rx="${n(Math.max(0, o.w / 2 - i))}" ry="${n(Math.max(0, o.h / 2 - i))}" ${st}/>`;
    case 'triangle':
      return `<polygon points="${n(o.w / 2)},${n(i)} ${n(o.w - i)},${n(o.h - i)} ${n(i)},${n(o.h - i)}" ${st} stroke-linejoin="round"/>`;
    case 'line':
      return `<line x1="0" y1="${n(o.h / 2)}" x2="${n(o.w)}" y2="${n(o.h / 2)}" ${st} stroke-linecap="butt"/>`;
  }
}

function errorBox(o: LabelObject, msg: string, editor?: boolean) {
  if (!editor) return '';
  msg = msg.slice(0, 60);
  const fs = Math.max(0.8, Math.min(3, o.h / 3, o.w / (msg.length * 0.62)));
  return `<rect width="${n(o.w)}" height="${n(o.h)}" fill="#fde8e8" stroke="#dc2626" stroke-width="0.2" stroke-dasharray="0.8 0.5"/>` +
    `<text x="${n(o.w / 2)}" y="${n(o.h / 2 + fs / 3)}" font-size="${n(fs)}" text-anchor="middle" fill="#b91c1c" font-family="sans-serif">${esc(msg)}</text>`;
}

function barcodeMarkup(o: BarcodeObj, content: string, editor?: boolean): string {
  const r = barcodeSvg(o, content);
  if ('error' in r) return errorBox(o, r.error, editor);
  let sx = o.w / r.vw, sy = o.h / r.vh, dx = 0, dy = 0;
  if (o.keepAspect) {
    const s = Math.min(sx, sy);
    dx = (o.w - r.vw * s) / 2; dy = (o.h - r.vh * s) / 2; sx = sy = s;
  }
  return `<g transform="translate(${n(dx)} ${n(dy)}) scale(${n(sx)} ${n(sy)})">${r.inner}</g>`;
}

function qrMarkup(o: QrObj, content: string, editor?: boolean): string {
  const r = code2dSvg(o, content);
  if ('error' in r) return errorBox(o, r.error, editor);
  const s = Math.min(o.w / r.vw, o.h / r.vh);
  const dx = (o.w - r.vw * s) / 2, dy = (o.h - r.vh * s) / 2;
  let out = `<g transform="translate(${n(dx)} ${n(dy)}) scale(${n(s)})">${r.inner}</g>`;
  if (o.logo) {
    const ls = Math.min(o.w, o.h) * Math.min(0.35, o.logoScale);
    const lx = (o.w - ls) / 2, ly = (o.h - ls) / 2, padv = ls * 0.08;
    out += `<rect x="${n(lx - padv)}" y="${n(ly - padv)}" width="${n(ls + 2 * padv)}" height="${n(ls + 2 * padv)}" fill="${o.background || '#ffffff'}"/>` +
      `<image href="${o.logo}" x="${n(lx)}" y="${n(ly)}" width="${n(ls)}" height="${n(ls)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return out;
}

const PAR = { contain: 'xMidYMid meet', cover: 'xMidYMid slice', stretch: 'none' } as const;

function imageMarkup(o: ImageObj, editor?: boolean): string {
  if (!o.src) return editor ? `<rect width="${n(o.w)}" height="${n(o.h)}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.2" stroke-dasharray="1 0.6"/><text x="${n(o.w / 2)}" y="${n(o.h / 2 + 1)}" font-size="${n(Math.min(3, o.h / 3))}" text-anchor="middle" fill="#64748b" font-family="sans-serif">이미지</text>` : '';
  return `<image href="${o.src}" width="${n(o.w)}" height="${n(o.h)}" preserveAspectRatio="${PAR[o.fit]}"/>`;
}

export function sanitizeSvg(raw: string): { viewBox: string; inner: string } | null {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg || doc.querySelector('parsererror')) return null;
  svg.querySelectorAll('script,foreignObject,iframe').forEach((e) => e.remove());
  svg.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  let vb = svg.getAttribute('viewBox');
  if (!vb) {
    const w = parseFloat(svg.getAttribute('width') || '100'), h = parseFloat(svg.getAttribute('height') || '100');
    vb = `0 0 ${w} ${h}`;
  }
  return { viewBox: vb, inner: svg.innerHTML };
}

const svgCache = new Map<string, ReturnType<typeof sanitizeSvg>>();
function svgMarkup(o: SvgObj, editor?: boolean): string {
  if (!o.svg) return imageMarkup({ ...o, type: 'image', src: '', fit: 'contain' }, editor).replace('이미지', 'SVG');
  let s = svgCache.get(o.svg);
  if (s === undefined) { s = sanitizeSvg(o.svg); svgCache.set(o.svg, s); }
  if (!s) return errorBox(o, 'SVG 오류', editor);
  return `<svg x="0" y="0" width="${n(o.w)}" height="${n(o.h)}" viewBox="${esc(s.viewBox)}" preserveAspectRatio="${o.fit === 'stretch' ? 'none' : 'xMidYMid meet'}">${s.inner}</svg>`;
}

function tableMarkup(o: TableObj, ctx: ResolveCtx, acc: Acc): string {
  const { rows, cols, xs, ys } = tableGeometry(o);
  const spans = cellSpans(o);
  const bg: string[] = [], txt: string[] = [], grid: string[] = [];
  const pad = Math.max(0, o.padding);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = cellKey(r, c);
    const span = spans.get(k);
    if (span === null) continue;
    const rs = span?.rs ?? 1, cs = span?.cs ?? 1;
    const x0 = xs[c], y0 = ys[r], w = xs[c + cs] - x0, h = ys[r + rs] - y0;
    const head = (o.headerRow && r === 0) || (o.headerCol && c === 0);
    const st = o.styles[k] ?? {};
    const fill = st.fill || (head ? o.headerFill : o.fill);
    if (fill) bg.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`);
    if (o.borderWidth > 0) grid.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}"/>`);
    const content = resolveTemplate(o.cells[r]?.[c] ?? '', ctx);
    if (!content) continue;
    const t: TextObj = {
      id: `${o.id}_${r}_${c}`, type: 'text', name: '', x: 0, y: 0, w: Math.max(0.1, w - 2 * pad), h: Math.max(0.1, h - 2 * pad),
      rotation: 0, opacity: 1, locked: false, hidden: false, rules: [], hideIfEmpty: false,
      content, fontFamily: o.fontFamily, fontSize: o.fontSize, minFontSize: o.minFontSize,
      bold: st.bold ?? head, italic: false, underline: false, align: st.align ?? o.align, vAlign: o.vAlign,
      multiline: true, fit: 'shrink', letterSpacing: 0, lineHeight: 1.15, ellipsis: false,
      fill: { type: 'solid', color: st.color || (head ? o.headerColor : o.color) }, effects: {},
    };
    txt.push(`<g transform="translate(${n(x0 + pad)} ${n(y0 + pad)})">${textMarkup(t, content, acc)}</g>`);
  }
  const gridG = grid.length ? `<g fill="none" stroke="${o.borderColor}" stroke-width="${n(o.borderWidth)}">${grid.join('')}</g>` : '';
  const ow = o.outerWidth;
  const outer = ow > 0 ? `<rect x="${n(ow / 2)}" y="${n(ow / 2)}" width="${n(Math.max(0, o.w - ow))}" height="${n(Math.max(0, o.h - ow))}" fill="none" stroke="${o.borderColor}" stroke-width="${n(ow)}"/>` : '';
  return bg.join('') + txt.join('') + gridG + outer;
}

function bodyMarkup(o: LabelObject, content: string, acc: Acc, ctx: ResolveCtx, editor?: boolean, override?: string): string {
  switch (o.type) {
    case 'text': return textMarkup(o, content, acc, override);
    case 'rect': case 'ellipse': case 'triangle': case 'line': return shapeMarkup(o, acc, override);
    case 'barcode': return barcodeMarkup(o, content, editor);
    case 'qr': return qrMarkup(o, content, editor);
    case 'image': return imageMarkup(o, editor);
    case 'svg': return svgMarkup(o, editor);
    case 'table': return tableMarkup(o, ctx, acc);
  }
}

export const objTransform = (o: LabelObject) =>
  o.rotation
    ? `translate(${n(o.x + o.w / 2)} ${n(o.y + o.h / 2)}) rotate(${n(o.rotation)}) translate(${n(-o.w / 2)} ${n(-o.h / 2)})`
    : `translate(${n(o.x)} ${n(o.y)})`;

export function objectMarkup(src: LabelObject, ctx: ResolveCtx, acc: Acc, opts: RenderOpts): string {
  if (src.hidden) return '';
  const { obj: o, content, hidden } = resolveObject(src, ctx);
  if (hidden && !opts.editor) return '';
  const patch = opts.raster?.get(o.id);
  if (patch) return `<image href="${patch.href}" x="${n(patch.x)}" y="${n(patch.y)}" width="${n(patch.w)}" height="${n(patch.h)}" preserveAspectRatio="none"/>`;
  let inner = '';
  const fx = 'effects' in o ? o.effects : undefined;
  if (fx?.shadow && (o.type === 'text' || o.type === 'rect' || o.type === 'ellipse' || o.type === 'triangle' || o.type === 'line')) {
    const sh = fx.shadow;
    let filt = '';
    if (sh.blur > 0) {
      const fid = `${acc.idp}f${o.id}`;
      acc.defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(sh.blur / 2)}"/></filter>`);
      filt = ` filter="url(#${fid})"`;
    }
    inner += `<g transform="translate(${n(sh.dx)} ${n(sh.dy)})" opacity="${n(sh.opacity)}"${filt}>${bodyMarkup(o, content, acc, ctx, opts.editor, sh.color)}</g>`;
  }
  inner += bodyMarkup(o, content, acc, ctx, opts.editor);
  const op = (hidden ? 0.18 : 1) * o.opacity;
  return `<g transform="${objTransform(o)}"${op !== 1 ? ` opacity="${n(op)}"` : ''} data-id="${o.id}">${inner}</g>`;
}

/** Label content in label-local mm coordinates. */
export function labelMarkup(p: Project, objects: LabelObject[], ctx: ResolveCtx, opts: RenderOpts = {}): string {
  const acc: Acc = { defs: [], idp: opts.idp ?? 'l' };
  const paper = p.paper;
  let bg = '';
  if (opts.paperBg !== false) {
    // with bleed the label colour and background extend past the trim line
    const bl = Math.max(0, paper.bleed);
    const box = `x="${n(-bl)}" y="${n(-bl)}" width="${n(paper.labelWidth + 2 * bl)}" height="${n(paper.labelHeight + 2 * bl)}"`;
    if (paper.labelColor && paper.labelColor !== '#ffffff') bg += `<rect ${box} rx="${n(bl ? 0 : paper.cornerRadius)}" fill="${paper.labelColor}"/>`;
    const b = paper.background;
    if (b?.src && (opts.editor || b.print)) {
      bg += `<image href="${b.src}" ${box} preserveAspectRatio="${PAR[b.fit]}" opacity="${n(b.opacity)}"/>`;
    }
  }
  const body = objects.filter((o) => (!opts.only || opts.only.has(o.id)) && (opts.editor || !o.noPrint)).map((o) => objectMarkup(o, ctx, acc, opts)).join('');
  return (acc.defs.length ? `<defs>${acc.defs.join('')}</defs>` : '') + bg + body;
}

export function fontFaceCss(p: Project): string {
  return p.fonts.map((f) => `@font-face{font-family:"${f.family}";src:url(data:font/${f.format === 'truetype' ? 'ttf' : f.format === 'opentype' ? 'otf' : f.format};base64,${f.data}) format("${f.format}");}`).join('');
}

/** Standalone SVG for one label (PNG export). */
export function labelDocument(p: Project, objects: LabelObject[], ctx: ResolveCtx, opts: RenderOpts & { embedFonts?: boolean; white?: boolean } = {}): string {
  const { labelWidth: w, labelHeight: h } = p.paper;
  const style = opts.embedFonts && p.fonts.length ? `<style>${fontFaceCss(p)}</style>` : '';
  const white = opts.white ? `<rect width="${n(w)}" height="${n(h)}" fill="#ffffff"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}">${style}${white}${labelMarkup(p, objects, ctx, opts)}</svg>`;
}

/* ---------- sheets ---------- */

export function cellOrigin(paper: Paper, index: number) {
  const c = index % paper.cols, r = Math.floor(index / paper.cols);
  return { x: paper.marginLeft + c * (paper.labelWidth + paper.gapX), y: paper.marginTop + r * (paper.labelHeight + paper.gapY), col: c, row: r };
}

export interface SheetCell {
  objects: LabelObject[];
  ctx: ResolveCtx;
  raster?: Map<string, RasterPatch>;
  /** fold printing: the back side drawn next to this cell */
  back?: SheetCell | null;
}

/**
 * Fold printing: the back is printed on the same side of the sheet, next to the front
 * (`right`) or below it (`below`), and the piece is folded along the shared edge.
 * `rotate` turns the back 180° (needed when folding along a horizontal line).
 */
export interface Fold { dir: 'right' | 'below'; rotate: boolean }

export interface SheetOpts {
  cropMarks?: boolean;
  /** name the outer crop marks (TRIM / BLEED / FOLD) */
  markLabels?: boolean;
  testPoints?: TestPoints;
  outlines?: boolean; // draw label outlines (test page / preview)
  calibrate?: boolean;
  embedFonts?: boolean;
  /** mirror columns (long edge flip) or rows (short edge) for back sides */
  mirror?: 'none' | 'cols' | 'rows';
  fold?: Fold | null;
}

/** Placement grid of a sheet. Without fold this is the paper's label grid; with fold, each unit holds front + back. */
export interface SheetLayout {
  width: number; height: number;
  cols: number; rows: number;
  unitW: number; unitH: number;
  x0: number; y0: number;
  gapX: number; gapY: number;
  /** the page had to grow to fit one fold unit */
  grown: boolean;
}

export function sheetLayout(pa: Paper, fold?: Fold | null): SheetLayout {
  if (!fold) {
    return {
      width: pa.width, height: pa.height, cols: pa.cols, rows: pa.rows, unitW: pa.labelWidth, unitH: pa.labelHeight,
      x0: pa.marginLeft, y0: pa.marginTop, gapX: pa.gapX, gapY: pa.gapY, grown: false,
    };
  }
  const unitW = pa.labelWidth * (fold.dir === 'right' ? 2 : 1);
  const unitH = pa.labelHeight * (fold.dir === 'below' ? 2 : 1);
  const bl = Math.max(0, pa.bleed);
  // fold units go on plain paper: keep room for bleed between them and centre the block
  const gapX = Math.max(pa.gapX, 2 * bl), gapY = Math.max(pa.gapY, 2 * bl);
  const m = Math.max(0, Math.min(pa.marginLeft, pa.marginTop));
  const fit = (avail: number, unit: number, gap: number) => Math.floor((avail - 2 * m + gap + 1e-6) / (unit + gap));
  let width = pa.width, height = pa.height, cols = fit(width, unitW, gapX), rows = fit(height, unitH, gapY), grown = false;
  if (cols < 1) { cols = 1; width = unitW + 2 * m; grown = true; }
  if (rows < 1) { rows = 1; height = unitH + 2 * m; grown = true; }
  const x0 = (width - (cols * unitW + (cols - 1) * gapX)) / 2;
  const y0 = (height - (rows * unitH + (rows - 1) * gapY)) / 2;
  return { width, height, cols, rows, unitW, unitH, x0, y0, gapX, gapY, grown };
}

function unitOrigin(L: SheetLayout, index: number) {
  const col = index % L.cols, row = Math.floor(index / L.cols);
  return { x: L.x0 + col * (L.unitW + L.gapX), y: L.y0 + row * (L.unitH + L.gapY), col, row };
}

interface Sides { l: number; t: number; r: number; b: number }

function placeLabel(p: Project, cell: SheetCell, x: number, y: number, b: Sides, cid: string, rotate: boolean): string {
  const pa = p.paper, W = pa.labelWidth, H = pa.labelHeight;
  const tf = rotate ? `translate(${n(x + W)} ${n(y + H)}) rotate(180)` : `translate(${n(x)} ${n(y)})`;
  const rx = b.l || b.t || b.r || b.b ? 0 : pa.cornerRadius;
  return `<clipPath id="${cid}"><rect x="${n(-b.l)}" y="${n(-b.t)}" width="${n(W + b.l + b.r)}" height="${n(H + b.t + b.b)}" rx="${n(rx)}"/></clipPath>` +
    `<g transform="${tf}"><g clip-path="url(#${cid})">${labelMarkup(p, cell.objects, cell.ctx, { idp: cid + '_', raster: cell.raster })}</g></g>`;
}

export function sheetDocument(p: Project, cells: (SheetCell | null)[], o: SheetOpts = {}, pageNo = 0): string {
  const pa = p.paper;
  const L = sheetLayout(pa, o.fold);
  const W = pa.labelWidth, H = pa.labelHeight;
  const parts: string[] = [];
  const bl = Math.max(0, pa.bleed);
  // bleed reaches at most halfway into the gap between neighbours, so it never shows on the next label
  const side = (edge: boolean, gap: number) => (edge ? bl : Math.min(bl, gap / 2));
  const outline = (x: number, y: number) => `<rect x="${n(x)}" y="${n(y)}" width="${n(W)}" height="${n(H)}" rx="${n(pa.cornerRadius)}" fill="none" stroke="#9ca3af" stroke-width="0.2"/>`;
  cells.forEach((cell, i) => {
    let idx = i;
    if (!o.fold && o.mirror === 'cols') idx = Math.floor(i / L.cols) * L.cols + (L.cols - 1 - (i % L.cols));
    if (!o.fold && o.mirror === 'rows') idx = (L.rows - 1 - Math.floor(i / L.cols)) * L.cols + (i % L.cols);
    const { x, y, col, row } = unitOrigin(L, idx);
    const b: Sides = { l: side(col === 0, L.gapX), r: side(col === L.cols - 1, L.gapX), t: side(row === 0, L.gapY), b: side(row === L.rows - 1, L.gapY) };
    const cid = `c${pageNo}_${i}`;
    if (!o.fold) {
      if (o.outlines) parts.push(outline(x, y));
      if (cell) parts.push(placeLabel(p, cell, x, y, b, cid, false));
      return;
    }
    const right = o.fold.dir === 'right';
    const bx = x + (right ? W : 0), by = y + (right ? 0 : H);
    if (o.outlines) parts.push(outline(x, y), outline(bx, by));
    if (!cell) return;
    // no bleed across the fold line, otherwise one side would spill onto the other
    const front: Sides = right ? { ...b, r: 0 } : { ...b, b: 0 };
    let back: Sides = right ? { ...b, l: 0 } : { ...b, t: 0 };
    if (o.fold.rotate) back = { l: back.r, r: back.l, t: back.b, b: back.t };
    parts.push(placeLabel(p, cell, x, y, front, cid, false));
    if (cell.back) parts.push(placeLabel(p, cell.back, bx, by, back, cid + 'b', o.fold.rotate));
  });
  if (o.cropMarks) parts.push(cropMarks(pa, L, o.fold, o.markLabels));
  if (o.testPoints) parts.push(testPointsMarkup(p, L, o));
  const cal = p.calibration;
  const tf = o.calibrate && (cal.offsetX || cal.offsetY || cal.scaleX !== 1 || cal.scaleY !== 1)
    ? ` transform="translate(${n(cal.offsetX)} ${n(cal.offsetY)}) scale(${n(cal.scaleX)} ${n(cal.scaleY)})"` : '';
  const style = o.embedFonts && p.fonts.length ? `<style>${fontFaceCss(p)}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(L.width)}mm" height="${n(L.height)}mm" viewBox="0 0 ${n(L.width)} ${n(L.height)}">${style}<g${tf}>${parts.join('')}</g></svg>`;
}

/**
 * Corner crop marks for every unit, kept outside the printed area. Each corner gets a long mark
 * on the trim line (the label edge) and, with bleed, a shorter one on the bleed edge. Marks
 * between units are drawn only when the gap leaves room for them; fold lines (which carry no
 * bleed) get dashed marks. With `labels`, the outermost marks at the sheet's corners are named
 * (only there, so neighbouring names never collide).
 */
function cropMarks(pa: Paper, L: SheetLayout, fold?: Fold | null, labels?: boolean): string {
  const bl = Math.max(0, pa.bleed);
  const ext = (edge: boolean, gap: number) => (edge ? bl : Math.min(bl, gap / 2));
  const mark = (edge: boolean, gap: number) => {
    const g = ext(edge, gap) + 1;
    const len = edge ? 3 : Math.min(3, gap / 2 - g);
    return len >= 0.8 ? { g, len } : null;
  };
  const out: string[] = [], dash: string[] = [], txt: string[] = [];
  const fs = 0.9;
  // names run along their mark, on the side away from the neighbouring mark (side: +1 right/below, -1 left/above)
  const vText = (xx: number, y0: number, dy: number, side: number, s: string) => {
    const bx = side > 0 ? xx + 0.3 + fs * 0.75 : xx - 0.3;
    txt.push(`<text transform="translate(${n(bx)} ${n(y0)}) rotate(-90)" text-anchor="${dy < 0 ? 'start' : 'end'}">${s}</text>`);
  };
  const hText = (yy: number, x0: number, dx: number, side: number, s: string) => {
    const by = side > 0 ? yy + 0.3 + fs * 0.75 : yy - 0.3;
    txt.push(`<text x="${n(x0)}" y="${n(by)}" text-anchor="${dx < 0 ? 'end' : 'start'}">${s}</text>`);
  };
  for (let i = 0; i < L.cols * L.rows; i++) {
    const { x, y, col, row } = unitOrigin(L, i);
    const x1 = x + L.unitW, y1 = y + L.unitH;
    const el = ext(col === 0, L.gapX), er = ext(col === L.cols - 1, L.gapX);
    const et = ext(row === 0, L.gapY), eb = ext(row === L.rows - 1, L.gapY);
    const ml = mark(col === 0, L.gapX), mr = mark(col === L.cols - 1, L.gapX);
    const mt = mark(row === 0, L.gapY), mb = mark(row === L.rows - 1, L.gapY);
    const named = { t: !!labels && row === 0, b: !!labels && row === L.rows - 1, l: !!labels && col === 0, r: !!labels && col === L.cols - 1 };
    // vertical marks are named at the left edge of the first column and the right edge of the last
    // (plus the first fold line); horizontal marks likewise by row
    const foldX = fold?.dir === 'right' ? x + pa.labelWidth : NaN, foldY = fold?.dir === 'below' ? y + pa.labelHeight : NaN;
    const outerX = (xx: number) => (col === 0 && (xx <= x || xx === foldX)) || (col === L.cols - 1 && xx >= x1);
    const outerY = (yy: number) => (row === 0 && (yy <= y || yy === foldY)) || (row === L.rows - 1 && yy >= y1);
    // k shortens the bleed-edge marks so they read apart from the trim marks
    const vMarks = (xx: number, to: string[], k: number, side: number, name: string) => {
      if (mt) { to.push(`M${n(xx)} ${n(y - mt.g)}V${n(y - mt.g - mt.len * k)}`); if (named.t && outerX(xx)) vText(xx, y - mt.g, -1, side, name); }
      if (mb) { to.push(`M${n(xx)} ${n(y1 + mb.g)}V${n(y1 + mb.g + mb.len * k)}`); if (named.b && outerX(xx)) vText(xx, y1 + mb.g, 1, side, name); }
    };
    const hMarks = (yy: number, to: string[], k: number, side: number, name: string) => {
      if (ml) { to.push(`M${n(x - ml.g)} ${n(yy)}H${n(x - ml.g - ml.len * k)}`); if (named.l && outerY(yy)) hText(yy, x - ml.g, -1, side, name); }
      if (mr) { to.push(`M${n(x1 + mr.g)} ${n(yy)}H${n(x1 + mr.g + mr.len * k)}`); if (named.r && outerY(yy)) hText(yy, x1 + mr.g, 1, side, name); }
    };
    vMarks(x, out, 1, 1, 'TRIM'); vMarks(x1, out, 1, -1, 'TRIM'); hMarks(y, out, 1, 1, 'TRIM'); hMarks(y1, out, 1, -1, 'TRIM');
    const B = 0.6;
    if (el > 0.05) vMarks(x - el, out, B, -1, 'BLEED');
    if (er > 0.05) vMarks(x1 + er, out, B, 1, 'BLEED');
    if (et > 0.05) hMarks(y - et, out, B, -1, 'BLEED');
    if (eb > 0.05) hMarks(y1 + eb, out, B, 1, 'BLEED');
    if (fold?.dir === 'right') vMarks(foldX, dash, 1, 1, 'FOLD');
    if (fold?.dir === 'below') hMarks(foldY, dash, 1, 1, 'FOLD');
  }
  return `<path d="${out.join('')}" stroke="#000" stroke-width="0.15" fill="none"/>` +
    (dash.length ? `<path d="${dash.join('')}" stroke="#000" stroke-width="0.15" stroke-dasharray="0.8 0.5" fill="none"/>` : '') +
    (txt.length ? `<g font-family="sans-serif" font-size="${fs}" fill="#000">${txt.join('')}</g>` : '');
}

/* ---------- test points ---------- */

/** Print checks placed in the paper margin, outside the labels and their crop marks. */
export interface TestPoints { process?: boolean; gray?: boolean; design?: boolean; lines?: boolean; registration?: boolean }

type TestItem = { kind: 'patch'; color: string; label: string } | { kind: 'lines'; w: number; label: string } | { kind: 'reg' };
type Side = 'bottom' | 'top' | 'right' | 'left';
/** A margin band: `at` is its edge next to the labels, `dir` points away from them. */
interface Strip { side: Side; at: number; t: number; len: number; dir: 1 | -1 }
interface TestPlacement { strip: Strip; s: number; labels: boolean; items: TestItem[] }

const PROCESS: [string, string][] = [['#00ffff', 'C'], ['#ff00ff', 'M'], ['#ffff00', 'Y'], ['#000000', 'K'], ['#ff0000', 'R'], ['#00ff00', 'G'], ['#0000ff', 'B']];
const GRAY = [100, 80, 60, 40, 20, 10, 5];
const LINE_WIDTHS = [0.1, 0.2, 0.3];

/** Distinct colours used by the designs (white left out), to check how they come out on paper. */
export function designColors(p: Project, max = 16): string[] {
  const out = new Set<string>();
  const add = (c?: string) => {
    let v = (c ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((h) => h + h).join('');
    if (/^#[0-9a-f]{6}$/.test(v) && v !== '#ffffff') out.add(v);
  };
  const fill = (f: Fill) => { if (f.type === 'solid') add(f.color); else if (f.type !== 'none') f.stops.forEach((s) => add(s.color)); };
  add(p.paper.labelColor);
  for (const d of p.designs) for (const o of [...d.objects, ...(d.back ?? [])]) {
    switch (o.type) {
      case 'text': fill(o.fill); if (o.effects.outline) add(o.effects.outline.color); break;
      case 'rect': case 'ellipse': case 'triangle': case 'line':
        if (o.type !== 'line') fill(o.fill);
        if (o.strokeWidth > 0) add(o.stroke);
        break;
      case 'barcode': case 'qr': add(o.color); add(o.background); break;
      case 'table':
        [o.color, o.fill, o.headerFill, o.headerColor, o.borderColor].forEach(add);
        Object.values(o.styles).forEach((st) => { add(st.fill); add(st.color); });
        break;
    }
  }
  return [...out].slice(0, max);
}

function testItems(p: Project, t: TestPoints): TestItem[] {
  const items: TestItem[] = [];
  if (t.process) PROCESS.forEach(([color, label]) => items.push({ kind: 'patch', color, label }));
  if (t.gray) GRAY.forEach((v) => {
    const h = Math.round(255 * (1 - v / 100)).toString(16).padStart(2, '0');
    items.push({ kind: 'patch', color: `#${h}${h}${h}`, label: `${v}%` });
  });
  if (t.design) designColors(p).forEach((color) => items.push({ kind: 'patch', color, label: color.slice(1) }));
  if (t.lines) LINE_WIDTHS.forEach((w) => items.push({ kind: 'lines', w, label: `${w}` }));
  if (t.registration) { items.unshift({ kind: 'reg' }); items.push({ kind: 'reg' }); }
  return items;
}

/** Picks the margin band that fits the largest patches. `shrink` keeps room for other content at a band's outer edge. */
function placeTestPoints(p: Project, L: SheetLayout, o: SheetOpts, shrink: Partial<Record<Side, number>> = {}): TestPlacement | null {
  const items = testItems(p, o.testPoints ?? {});
  if (!items.length) return null;
  const reserve = Math.max(0, p.paper.bleed) + (o.cropMarks ? 4.5 : 0.8);
  const x1 = L.x0 + L.cols * L.unitW + (L.cols - 1) * L.gapX, y1 = L.y0 + L.rows * L.unitH + (L.rows - 1) * L.gapY;
  const strips: Strip[] = [
    { side: 'bottom', at: y1 + reserve, t: L.height - y1 - reserve, len: L.width, dir: 1 },
    { side: 'top', at: L.y0 - reserve, t: L.y0 - reserve, len: L.width, dir: -1 },
    { side: 'right', at: x1 + reserve, t: L.width - x1 - reserve, len: L.height, dir: 1 },
    { side: 'left', at: L.x0 - reserve, t: L.x0 - reserve, len: L.height, dir: -1 },
  ];
  let best: TestPlacement | null = null;
  for (const st of strips) {
    const t = st.t - (shrink[st.side] ?? 0);
    const along = (st.len - 4) / items.length - 0.6;
    const room = st.side === 'bottom' || st.side === 'top' ? 1.8 : 6; // space for the names beside the patches
    const named = Math.min(5, t - room - 0.5, along), bare = Math.min(5, t - 0.5, along);
    const pick = named >= 2.5 ? { s: named, labels: true } : { s: bare, labels: false };
    if (pick.s >= 2 && (!best || pick.s > best.s)) best = { strip: st, items, ...pick };
  }
  return best;
}

/** the 50 mm ruler sits in the bottom 12 mm of the test page */
const TEST_PAGE_SHRINK = { bottom: 12 };

/** True when the chosen test points fit in a margin of the sheet, or of the test page with `test` (or none are chosen). */
export function testPointsFit(p: Project, o: SheetOpts, test = false): boolean {
  return !testItems(p, o.testPoints ?? {}).length ||
    !!placeTestPoints(p, sheetLayout(p.paper, test ? null : o.fold), o, test ? TEST_PAGE_SHRINK : {});
}

function testItemMarkup(it: TestItem, x: number, y: number, s: number): string {
  switch (it.kind) {
    case 'patch': return `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" fill="${it.color}"/>`;
    case 'lines': {
      // lines and gaps of the same width, kept inside the square
      let d = '';
      for (let lx = it.w / 2; lx <= s - it.w / 2 + 1e-6; lx += 2 * it.w) d += `M${n(x + lx)} ${n(y)}V${n(y + s)}`;
      return `<path d="${d}" stroke="#000" stroke-width="${n(it.w)}" fill="none"/>`;
    }
    case 'reg': {
      const cx = x + s / 2, cy = y + s / 2;
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s * 0.32)}" fill="none" stroke="#000" stroke-width="0.12"/>` +
        `<path d="M${n(x)} ${n(cy)}H${n(x + s)}M${n(cx)} ${n(y)}V${n(y + s)}" stroke="#000" stroke-width="0.12" fill="none"/>`;
    }
  }
}

function testPointsMarkup(p: Project, L: SheetLayout, o: SheetOpts, shrink?: Partial<Record<Side, number>>): string {
  const pl = placeTestPoints(p, L, o, shrink);
  if (!pl) return '';
  const { strip: st, s, labels, items } = pl;
  const horiz = st.side === 'bottom' || st.side === 'top';
  const step = s + 0.6;
  let a = (st.len - (items.length * step - 0.6)) / 2;
  const c = st.dir > 0 ? st.at : st.at - s;
  const fs = Math.min(1.2, s * 0.3);
  const out: string[] = [], txt: string[] = [];
  for (const it of items) {
    const x = horiz ? a : c, y = horiz ? c : a;
    out.push(testItemMarkup(it, x, y, s));
    if (labels && it.kind !== 'reg') {
      // names go on the outer side, away from the labels
      if (horiz) txt.push(`<text x="${n(x + s / 2)}" y="${n(st.dir > 0 ? y + s + 0.3 + fs * 0.75 : y - 0.4)}" text-anchor="middle">${esc(it.label)}</text>`);
      else txt.push(`<text x="${n(st.dir > 0 ? x + s + 0.5 : x - 0.5)}" y="${n(y + s / 2 + fs * 0.35)}" text-anchor="${st.dir > 0 ? 'start' : 'end'}">${esc(it.label)}</text>`);
    }
    a += step;
  }
  return out.join('') + (txt.length ? `<g font-family="sans-serif" font-size="${n(fs)}" fill="#000">${txt.join('')}</g>` : '');
}

/* ---------- calibration test page ---------- */

/** Calibration test page: label outlines, centre crosses and a 50 mm ruler, plus the chosen crop marks and test points. */
export function testPageDocument(p: Project, o: Pick<SheetOpts, 'cropMarks' | 'markLabels' | 'testPoints'> = {}): string {
  const pa = p.paper;
  const parts: string[] = [];
  for (let i = 0; i < pa.cols * pa.rows; i++) {
    const { x, y } = cellOrigin(pa, i);
    const cx = x + pa.labelWidth / 2, cy = y + pa.labelHeight / 2;
    parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(pa.labelWidth)}" height="${n(pa.labelHeight)}" rx="${n(pa.cornerRadius)}" fill="none" stroke="#000" stroke-width="0.2"/>`);
    parts.push(`<path d="M${n(cx - 3)} ${n(cy)}H${n(cx + 3)}M${n(cx)} ${n(cy - 3)}V${n(cy + 3)}" stroke="#000" stroke-width="0.2"/>`);
    parts.push(`<text x="${n(x + 1.5)}" y="${n(y + 4)}" font-size="3" font-family="sans-serif">${i + 1}</text>`);
  }
  const L = sheetLayout(pa, null);
  if (o.cropMarks) parts.push(cropMarks(pa, L, null, o.markLabels));
  if (o.testPoints) parts.push(testPointsMarkup(p, L, o, TEST_PAGE_SHRINK));
  // the bottom margin holds crop marks when they are on, so the ruler moves into the first label if it fits
  const inside = !!o.cropMarks && pa.labelWidth >= 54 && pa.labelHeight >= 16;
  const rx = inside ? pa.marginLeft + (pa.labelWidth - 50) / 2 : 10, ry = inside ? pa.marginTop + pa.labelHeight - 3 : pa.height - 8;
  let ruler = `<path d="M${n(rx)} ${n(ry)}H${n(rx + 50)}`;
  for (let i = 0; i <= 50; i += 5) ruler += `M${n(rx + i)} ${n(ry)}V${n(ry - (i % 10 === 0 ? 3 : 1.5))}`;
  ruler += `" stroke="#000" stroke-width="0.2" fill="none"/>` + (inside
    ? `<text x="${n(rx + 50)}" y="${n(ry - 4)}" font-size="2.5" text-anchor="end" font-family="sans-serif">50 mm</text>`
    : `<text x="${rx + 52}" y="${ry}" font-size="3" font-family="sans-serif">50 mm</text>`);
  const cal = p.calibration;
  const tf = ` transform="translate(${n(cal.offsetX)} ${n(cal.offsetY)}) scale(${n(cal.scaleX)} ${n(cal.scaleY)})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(pa.width)}mm" height="${n(pa.height)}mm" viewBox="0 0 ${n(pa.width)} ${n(pa.height)}"><g${tf}>${parts.join('')}${ruler}</g></svg>`;
}
