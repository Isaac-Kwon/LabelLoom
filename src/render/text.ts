import type { TextObj } from '../model/types';

export const PT_TO_MM = 25.4 / 72;
const REF = 100; // measuring size in px

let ctx2d: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();
const metricCache = new Map<string, { ascent: number; descent: number }>();

function c2d() {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d')!;
  return ctx2d;
}

export const fontCss = (o: Pick<TextObj, 'bold' | 'italic' | 'fontFamily'>, px: number) =>
  `${o.italic ? 'italic ' : ''}${o.bold ? '700' : '400'} ${px}px ${o.fontFamily}`;

/** Width of a string at 1mm font size (in mm), excluding letter spacing. */
function unitWidth(font: string, s: string): number {
  const key = font + '\u0000' + s;
  let v = cache.get(key);
  if (v === undefined) {
    const c = c2d();
    c.font = font;
    v = c.measureText(s).width / REF;
    if (cache.size > 20000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

export function fontMetrics(font: string) {
  let m = metricCache.get(font);
  if (!m) {
    const c = c2d();
    c.font = font;
    const t = c.measureText('Hg가');
    const ascent = (t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? REF * 0.8) / REF;
    const descent = (t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? REF * 0.2) / REF;
    m = { ascent: ascent || 0.8, descent: descent || 0.2 };
    metricCache.set(font, m);
  }
  return m;
}

/** Call after a web font finishes loading. */
export function clearTextCache() { cache.clear(); metricCache.clear(); }

export interface TextLayout {
  sizeMm: number;
  lines: { text: string; width: number }[];
  lineAdvance: number;
  ascent: number;
  descent: number;
  scaleX: number;
}

function measure(o: TextObj, font: string, s: string, sizeMm: number) {
  return unitWidth(font, s) * sizeMm + o.letterSpacing * Math.max(0, [...s].length - 1);
}

function wrap(o: TextObj, font: string, para: string, sizeMm: number, maxW: number): string[] {
  if (para === '') return [''];
  const out: string[] = [];
  const words = para.split(/(\s+)/);
  let line = '';
  const push = () => { out.push(line.trimEnd()); line = ''; };
  for (const w of words) {
    if (w === '') continue;
    const cand = line + w;
    if (measure(o, font, cand.trimEnd(), sizeMm) <= maxW || line.trim() === '' && measure(o, font, w, sizeMm) <= maxW) {
      line = cand;
      continue;
    }
    if (/^\s+$/.test(w)) { push(); continue; }
    if (line.trim() !== '') push();
    // word longer than the line: break by characters
    if (measure(o, font, w, sizeMm) > maxW) {
      for (const ch of [...w]) {
        if (line !== '' && measure(o, font, line + ch, sizeMm) > maxW) push();
        line += ch;
      }
    } else line = w;
  }
  if (line !== '' || out.length === 0) out.push(line.trimEnd());
  return out;
}

function fits(o: TextObj, font: string, content: string, sizeMm: number, w: number, h: number) {
  const m = fontMetrics(font);
  if (!o.multiline) {
    const line = content.replace(/\n/g, ' ');
    return { ok: measure(o, font, line, sizeMm) <= w + 1e-6 && sizeMm * (m.ascent + m.descent) <= h + 1e-6, lines: [line] };
  }
  const lines = content.split('\n').flatMap((p) => wrap(o, font, p, sizeMm, w));
  const height = sizeMm * ((lines.length - 1) * o.lineHeight + m.ascent + m.descent);
  const widest = Math.max(...lines.map((l) => measure(o, font, l, sizeMm)));
  return { ok: height <= h + 1e-6 && widest <= w + 1e-6, lines };
}

function ellipsize(o: TextObj, font: string, s: string, sizeMm: number, w: number) {
  if (measure(o, font, s, sizeMm) <= w) return s;
  const chars = [...s];
  while (chars.length && measure(o, font, chars.join('') + '…', sizeMm) > w) chars.pop();
  return chars.join('') + '…';
}

export function layoutText(o: TextObj, content: string, sizePt = o.fontSize): TextLayout {
  const font = fontCss(o, REF);
  const m = fontMetrics(font);
  const w = Math.max(0.1, o.w);
  const h = Math.max(0.1, o.h);
  let sizeMm = sizePt * PT_TO_MM;
  let result = fits(o, font, content, sizeMm, w, h);

  if (o.fit === 'shrink' && !result.ok) {
    const min = Math.min(o.minFontSize, sizePt) * PT_TO_MM;
    let lo = min, hi = sizeMm;
    const atMin = fits(o, font, content, lo, w, h);
    if (!atMin.ok) { sizeMm = lo; result = atMin; } else {
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (fits(o, font, content, mid, w, h).ok) lo = mid; else hi = mid;
      }
      sizeMm = lo;
      result = fits(o, font, content, sizeMm, w, h);
    }
  }

  let lines = result.lines;
  let scaleX = 1;
  if (!o.multiline) {
    const width = measure(o, font, lines[0], sizeMm);
    if (o.fit === 'stretch' && width > w) scaleX = w / width;
    else if (o.ellipsis && width > w) lines = [ellipsize(o, font, lines[0], sizeMm, w)];
  } else if (o.ellipsis && !result.ok) {
    const adv = sizeMm * o.lineHeight;
    const max = Math.max(1, Math.floor((h - sizeMm * (m.ascent + m.descent)) / adv) + 1);
    if (lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = ellipsize(o, font, lines[max - 1] + '…', sizeMm, w);
    }
  }
  return {
    sizeMm,
    lines: lines.map((t) => ({ text: t, width: measure(o, font, t, sizeMm) * scaleX })),
    lineAdvance: sizeMm * o.lineHeight,
    ascent: m.ascent * sizeMm,
    descent: m.descent * sizeMm,
    scaleX,
  };
}
