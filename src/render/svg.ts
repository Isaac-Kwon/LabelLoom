import type { BarcodeObj, Fill, ImageObj, LabelObject, Paper, Project, QrObj, ShapeObj, SvgObj, TextObj } from '../model/types';
import { barcodeSvg, code2dSvg } from './barcode';
import { resolveObject, type ResolveCtx } from './resolve';
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

function bodyMarkup(o: LabelObject, content: string, acc: Acc, editor?: boolean, override?: string): string {
  switch (o.type) {
    case 'text': return textMarkup(o, content, acc, override);
    case 'rect': case 'ellipse': case 'triangle': case 'line': return shapeMarkup(o, acc, override);
    case 'barcode': return barcodeMarkup(o, content, editor);
    case 'qr': return qrMarkup(o, content, editor);
    case 'image': return imageMarkup(o, editor);
    case 'svg': return svgMarkup(o, editor);
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
    inner += `<g transform="translate(${n(sh.dx)} ${n(sh.dy)})" opacity="${n(sh.opacity)}"${filt}>${bodyMarkup(o, content, acc, opts.editor, sh.color)}</g>`;
  }
  inner += bodyMarkup(o, content, acc, opts.editor);
  const op = (hidden ? 0.18 : 1) * o.opacity;
  return `<g transform="${objTransform(o)}"${op !== 1 ? ` opacity="${n(op)}"` : ''} data-id="${o.id}">${inner}</g>`;
}

/** Label content in label-local mm coordinates. */
export function labelMarkup(p: Project, objects: LabelObject[], ctx: ResolveCtx, opts: RenderOpts = {}): string {
  const acc: Acc = { defs: [], idp: opts.idp ?? 'l' };
  const paper = p.paper;
  let bg = '';
  if (opts.paperBg !== false) {
    if (paper.labelColor && paper.labelColor !== '#ffffff') bg += `<rect width="${n(paper.labelWidth)}" height="${n(paper.labelHeight)}" rx="${n(paper.cornerRadius)}" fill="${paper.labelColor}"/>`;
    const b = paper.background;
    if (b?.src && (opts.editor || b.print)) {
      bg += `<image href="${b.src}" width="${n(paper.labelWidth)}" height="${n(paper.labelHeight)}" preserveAspectRatio="${PAR[b.fit]}" opacity="${n(b.opacity)}"/>`;
    }
  }
  const body = objects.filter((o) => !opts.only || opts.only.has(o.id)).map((o) => objectMarkup(o, ctx, acc, opts)).join('');
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

export interface SheetCell { objects: LabelObject[]; ctx: ResolveCtx; raster?: Map<string, RasterPatch> }

export interface SheetOpts {
  cropMarks?: boolean;
  outlines?: boolean; // draw label outlines (test page / preview)
  calibrate?: boolean;
  embedFonts?: boolean;
  /** mirror columns (long edge flip) or rows (short edge) for back sides */
  mirror?: 'none' | 'cols' | 'rows';
}

export function sheetDocument(p: Project, cells: (SheetCell | null)[], o: SheetOpts = {}, pageNo = 0): string {
  const pa = p.paper;
  const parts: string[] = [];
  const bl = pa.bleed;
  cells.forEach((cell, i) => {
    let idx = i;
    if (o.mirror === 'cols') idx = Math.floor(i / pa.cols) * pa.cols + (pa.cols - 1 - (i % pa.cols));
    if (o.mirror === 'rows') idx = (pa.rows - 1 - Math.floor(i / pa.cols)) * pa.cols + (i % pa.cols);
    const { x, y } = cellOrigin(pa, idx);
    if (o.outlines) parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(pa.labelWidth)}" height="${n(pa.labelHeight)}" rx="${n(pa.cornerRadius)}" fill="none" stroke="#9ca3af" stroke-width="0.2"/>`);
    if (!cell) return;
    const cid = `c${pageNo}_${i}`;
    parts.push(`<clipPath id="${cid}"><rect x="${n(-bl)}" y="${n(-bl)}" width="${n(pa.labelWidth + 2 * bl)}" height="${n(pa.labelHeight + 2 * bl)}" rx="${n(bl ? 0 : pa.cornerRadius)}"/></clipPath>`);
    parts.push(`<g transform="translate(${n(x)} ${n(y)})"><g clip-path="url(#${cid})">${labelMarkup(p, cell.objects, cell.ctx, { idp: cid + '_', raster: cell.raster })}</g></g>`);
  });
  if (o.cropMarks) parts.push(cropMarks(pa));
  const cal = p.calibration;
  const tf = o.calibrate && (cal.offsetX || cal.offsetY || cal.scaleX !== 1 || cal.scaleY !== 1)
    ? ` transform="translate(${n(cal.offsetX)} ${n(cal.offsetY)}) scale(${n(cal.scaleX)} ${n(cal.scaleY)})"` : '';
  const style = o.embedFonts && p.fonts.length ? `<style>${fontFaceCss(p)}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(pa.width)}mm" height="${n(pa.height)}mm" viewBox="0 0 ${n(pa.width)} ${n(pa.height)}">${style}<g${tf}>${parts.join('')}</g></svg>`;
}

function cropMarks(pa: Paper): string {
  const xs = new Set<number>(), ys = new Set<number>();
  for (let c = 0; c < pa.cols; c++) { const x = pa.marginLeft + c * (pa.labelWidth + pa.gapX); xs.add(x); xs.add(x + pa.labelWidth); }
  for (let r = 0; r < pa.rows; r++) { const y = pa.marginTop + r * (pa.labelHeight + pa.gapY); ys.add(y); ys.add(y + pa.labelHeight); }
  const L = 3, g = 1, out: string[] = [];
  const top = pa.marginTop, bottom = pa.marginTop + pa.rows * pa.labelHeight + (pa.rows - 1) * pa.gapY;
  const left = pa.marginLeft, right = pa.marginLeft + pa.cols * pa.labelWidth + (pa.cols - 1) * pa.gapX;
  xs.forEach((x) => { out.push(`M${n(x)} ${n(top - g - L)}V${n(top - g)}M${n(x)} ${n(bottom + g)}V${n(bottom + g + L)}`); });
  ys.forEach((y) => { out.push(`M${n(left - g - L)} ${n(y)}H${n(left - g)}M${n(right + g)} ${n(y)}H${n(right + g + L)}`); });
  return `<path d="${out.join('')}" stroke="#000" stroke-width="0.15" fill="none"/>`;
}

/** Calibration test page: label outlines, centre crosses and a 50 mm ruler. */
export function testPageDocument(p: Project): string {
  const pa = p.paper;
  const parts: string[] = [];
  for (let i = 0; i < pa.cols * pa.rows; i++) {
    const { x, y } = cellOrigin(pa, i);
    const cx = x + pa.labelWidth / 2, cy = y + pa.labelHeight / 2;
    parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(pa.labelWidth)}" height="${n(pa.labelHeight)}" rx="${n(pa.cornerRadius)}" fill="none" stroke="#000" stroke-width="0.2"/>`);
    parts.push(`<path d="M${n(cx - 3)} ${n(cy)}H${n(cx + 3)}M${n(cx)} ${n(cy - 3)}V${n(cy + 3)}" stroke="#000" stroke-width="0.2"/>`);
    parts.push(`<text x="${n(x + 1.5)}" y="${n(y + 4)}" font-size="3" font-family="sans-serif">${i + 1}</text>`);
  }
  const rx = 10, ry = pa.height - 8;
  let ruler = `<path d="M${rx} ${ry}H${rx + 50}`;
  for (let i = 0; i <= 50; i += 5) ruler += `M${rx + i} ${ry}V${ry - (i % 10 === 0 ? 3 : 1.5)}`;
  ruler += `" stroke="#000" stroke-width="0.2" fill="none"/><text x="${rx + 52}" y="${ry}" font-size="3" font-family="sans-serif">50 mm</text>`;
  const cal = p.calibration;
  const tf = ` transform="translate(${n(cal.offsetX)} ${n(cal.offsetY)}) scale(${n(cal.scaleX)} ${n(cal.scaleY)})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(pa.width)}mm" height="${n(pa.height)}mm" viewBox="0 0 ${n(pa.width)} ${n(pa.height)}"><g${tf}>${parts.join('')}${ruler}</g></svg>`;
}
