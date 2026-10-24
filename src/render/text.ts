import type { TextObj } from '../model/types';
import { parseRich, type Run } from './rich';

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

/** Part of a line in one style. `adv` is its advance in mm, letter spacing after each character included. */
export interface Piece { text: string; run: Run; adv: number }

export interface TextLine {
  pieces: Piece[];
  text: string;
  /** mm, letter spacing between characters only, after scaleX */
  width: number;
  /** largest size multiplier on the line (<size=…%>) */
  scale: number;
}

export interface TextLayout {
  sizeMm: number;
  lines: TextLine[];
  /** baseline of each line from the top of the text block, mm */
  baselines: number[];
  /** height of the text block, mm */
  height: number;
  lineAdvance: number;
  ascent: number;
  descent: number;
  scaleX: number;
  /** the text does not fit its box even after shrinking (it runs over) */
  overflow: boolean;
  /** characters were cut off with … */
  truncated: boolean;
}

type P = Omit<Piece, 'adv'>;

/** Measures pieces at one size for one object. */
function measurer(o: TextObj, sizeMm: number) {
  const fonts = new Map<Run, string>();
  const font = (r: Run) => {
    let f = fonts.get(r);
    if (!f) { f = fontCss({ bold: r.bold, italic: r.italic, fontFamily: o.fontFamily }, REF); fonts.set(r, f); }
    return f;
  };
  const adv = (p: P) => unitWidth(font(p.run), p.text) * sizeMm * p.run.scale + o.letterSpacing * [...p.text].length;
  const width = (ps: P[]) => {
    let w = 0, n = 0;
    for (const p of merge(ps)) { w += adv(p); n += p.text.length ? 1 : 0; }
    return n ? w - o.letterSpacing : 0;
  };
  return { adv, width };
}

/** Neighbouring pieces of one run joined, so a plain line is measured as one string. */
function merge(ps: P[]): P[] {
  const out: P[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && last.run === p.run) out[out.length - 1] = { run: p.run, text: last.text + p.text };
    else if (p.text) out.push(p);
  }
  return out;
}

const text = (ps: P[]) => ps.map((p) => p.text).join('');
const blank = (ps: P[]) => text(ps).trim() === '';

function trimEnd(ps: P[]): P[] {
  const out = [...ps];
  while (out.length) {
    const last = out[out.length - 1];
    const t = last.text.trimEnd();
    if (t) { out[out.length - 1] = { ...last, text: t }; break; }
    out.pop();
  }
  return out;
}

function appendChar(ps: P[], run: Run, ch: string): P[] {
  const last = ps[ps.length - 1];
  return last && last.run === run ? [...ps.slice(0, -1), { run, text: last.text + ch }] : [...ps, { run, text: ch }];
}

/** Runs of one paragraph as words and spaces; a word may span several runs. */
function segments(runs: Run[]): { space: boolean; pieces: P[] }[] {
  const out: { space: boolean; pieces: P[] }[] = [];
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      const last = out[out.length - 1];
      if (last && last.space === space) last.pieces.push({ text: part, run });
      else out.push({ space, pieces: [{ text: part, run }] });
    }
  }
  return out;
}

function wrap(runs: Run[], width: (ps: P[]) => number, maxW: number): P[][] {
  const out: P[][] = [];
  let line: P[] = [];
  const push = () => { out.push(trimEnd(line)); line = []; };
  for (const seg of segments(runs)) {
    const cand = [...line, ...seg.pieces];
    if (width(trimEnd(cand)) <= maxW || (blank(line) && width(seg.pieces) <= maxW)) { line = cand; continue; }
    if (seg.space) { push(); continue; }
    if (!blank(line)) push();
    if (width(seg.pieces) > maxW) {
      // word longer than the line: break by characters
      for (const p of seg.pieces) {
        for (const ch of [...p.text]) {
          const next = appendChar(line, p.run, ch);
          if (line.length && width(next) > maxW) { push(); line = appendChar([], p.run, ch); } else line = next;
        }
      }
    } else line = [...seg.pieces];
  }
  if (line.length || out.length === 0) out.push(trimEnd(line));
  return out;
}

/** Runs split at line breaks. */
function paragraphs(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  for (const r of runs) {
    r.text.split('\n').forEach((t, i) => {
      if (i > 0) out.push([]);
      if (t) out[out.length - 1].push({ ...r, text: t });
    });
  }
  return out;
}

const lineScale = (ps: P[]) => (ps.length ? Math.max(...ps.map((p) => p.run.scale)) : 1);

function blockHeight(o: TextObj, lines: P[][], sizeMm: number, m: { ascent: number; descent: number }) {
  const baselines: number[] = [];
  let y = 0;
  lines.forEach((ln, i) => {
    const s = lineScale(ln);
    y += i === 0 ? m.ascent * sizeMm * s : sizeMm * o.lineHeight * s;
    baselines.push(y);
  });
  const last = lines.length ? lineScale(lines[lines.length - 1]) : 1;
  return { baselines, height: y + m.descent * sizeMm * last };
}

function fits(o: TextObj, runs: Run[], sizeMm: number, w: number, h: number, m: { ascent: number; descent: number }) {
  const { width } = measurer(o, sizeMm);
  if (!o.multiline) {
    const line = runs.map((r) => ({ run: r, text: r.text.replace(/\n/g, ' ') })).filter((p) => p.text);
    const ok = width(line) <= w + 1e-6 && sizeMm * (m.ascent + m.descent) * lineScale(line) <= h + 1e-6;
    return { ok, lines: [line] };
  }
  const lines = paragraphs(runs).flatMap((p) => wrap(p, width, w));
  const { height } = blockHeight(o, lines, sizeMm, m);
  const widest = Math.max(...lines.map(width));
  return { ok: height <= h + 1e-6 && widest <= w + 1e-6, lines };
}

/** Cuts characters off the end until the line and an ellipsis fit `w`. */
function ellipsize(ps: P[], width: (ps: P[]) => number, w: number): P[] {
  if (width(ps) <= w) return ps;
  const chars = ps.flatMap((p) => [...p.text].map((ch) => ({ ch, run: p.run })));
  const build = () => {
    let out: P[] = [];
    for (const c of chars) out = appendChar(out, c.run, c.ch);
    const run = chars[chars.length - 1]?.run ?? ps[ps.length - 1]?.run ?? ps[0]?.run;
    return run ? appendChar(out, run, '…') : out;
  };
  while (chars.length && width(build()) > w) chars.pop();
  return build();
}

export const baseStyle = (o: TextObj) => ({ bold: o.bold, italic: o.italic, underline: o.underline, scale: 1 });

/**
 * Line breaking and sizing for a text object. `content` may hold rich-text tags (render/rich.ts);
 * `w` overrides the box width (text on a curve uses the arc length).
 */
export function layoutText(o: TextObj, content: string, sizePt = o.fontSize, boxW = o.w): TextLayout {
  const runs = parseRich(content, baseStyle(o));
  const m = fontMetrics(fontCss(o, REF));
  const w = Math.max(0.1, boxW);
  const h = Math.max(0.1, o.h);
  let sizeMm = sizePt * PT_TO_MM;
  let result = fits(o, runs, sizeMm, w, h, m);

  if (o.fit === 'shrink' && !result.ok) {
    const min = Math.min(o.minFontSize, sizePt) * PT_TO_MM;
    let lo = min, hi = sizeMm;
    const atMin = fits(o, runs, lo, w, h, m);
    if (!atMin.ok) { sizeMm = lo; result = atMin; } else {
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (fits(o, runs, mid, w, h, m).ok) lo = mid; else hi = mid;
      }
      sizeMm = lo;
      result = fits(o, runs, sizeMm, w, h, m);
    }
  }

  const { adv, width } = measurer(o, sizeMm);
  let lines = result.lines;
  let scaleX = 1;
  let truncated = false;
  let overflow = !result.ok;
  if (!o.multiline) {
    const lw = width(lines[0]);
    if (o.fit === 'stretch' && lw > w) { scaleX = w / lw; overflow = sizeMm * (m.ascent + m.descent) * lineScale(lines[0]) > h + 1e-6; }
    else if (o.ellipsis && lw > w) { lines = [ellipsize(lines[0], width, w)]; truncated = true; overflow = false; }
  } else if (o.ellipsis && !result.ok) {
    // keep the lines that fit the box height (at least one) and end the last with …
    let max = 1;
    while (max < lines.length && blockHeight(o, lines.slice(0, max + 1), sizeMm, m).height <= h + 1e-6) max++;
    if (lines.length > max) {
      lines = lines.slice(0, max);
      const last = lines[max - 1];
      const run = last[last.length - 1]?.run ?? runs[runs.length - 1];
      lines[max - 1] = ellipsize(appendChar(last, run, '…'), width, w);
      truncated = true;
    }
    overflow = blockHeight(o, lines, sizeMm, m).height > h + 1e-6 || lines.some((l) => width(l) > w + 1e-6);
  }
  const { baselines, height } = blockHeight(o, lines, sizeMm, m);
  return {
    sizeMm,
    lines: lines.map((ps) => ({
      pieces: merge(ps).map((p) => ({ ...p, adv: adv(p) })),
      text: text(ps),
      width: width(ps) * scaleX,
      scale: lineScale(ps),
    })),
    baselines,
    height,
    lineAdvance: sizeMm * o.lineHeight,
    ascent: m.ascent * sizeMm,
    descent: m.descent * sizeMm,
    scaleX,
    overflow,
    truncated,
  };
}
