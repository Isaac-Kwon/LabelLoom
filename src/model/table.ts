import type { TableCellStyle, TableMerge, TableObj } from './types';

/** Pure helpers for table objects: geometry, merges and structural edits. */

export const cellKey = (r: number, c: number) => `${r},${c}`;

export const tableSize = (o: TableObj) => ({ rows: o.cells.length, cols: o.cells[0]?.length ?? 0 });

function scale(weights: number[], n: number, total: number): number[] {
  const a = Array.from({ length: n }, (_, i) => Math.max(0.01, weights[i] ?? 1));
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((v) => (v / s) * total);
}

const prefix = (sizes: number[]) => sizes.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);

/** Grid line positions in object-local mm: xs has cols+1 entries, ys rows+1. */
export function tableGeometry(o: TableObj) {
  const { rows, cols } = tableSize(o);
  return { rows, cols, xs: prefix(scale(o.colWidths, cols, o.w)), ys: prefix(scale(o.rowHeights, rows, o.h)) };
}

/** Merges clipped to the grid, dropping degenerate or overlapping ones. */
export function validMerges(o: TableObj): TableMerge[] {
  const { rows, cols } = tableSize(o);
  const taken = new Set<string>();
  const out: TableMerge[] = [];
  for (const m of o.merges) {
    if (m.r < 0 || m.c < 0 || m.r >= rows || m.c >= cols) continue;
    const rs = Math.min(m.rs, rows - m.r), cs = Math.min(m.cs, cols - m.c);
    if (rs * cs < 2) continue;
    const keys: string[] = [];
    for (let r = m.r; r < m.r + rs; r++) for (let c = m.c; c < m.c + cs; c++) keys.push(cellKey(r, c));
    if (keys.some((k) => taken.has(k))) continue;
    keys.forEach((k) => taken.add(k));
    out.push({ r: m.r, c: m.c, rs, cs });
  }
  return out;
}

/** For each cell: its span if it is a merge origin, or null if it is hidden under a merge. */
export function cellSpans(o: TableObj): Map<string, { rs: number; cs: number } | null> {
  const map = new Map<string, { rs: number; cs: number } | null>();
  for (const m of validMerges(o)) {
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) map.set(cellKey(r, c), null);
    map.set(cellKey(m.r, m.c), { rs: m.rs, cs: m.cs });
  }
  return map;
}

/* ---------- structural edits (return patches) ---------- */

type Patch = Partial<TableObj>;

function shiftStyles(o: TableObj, axis: 'r' | 'c', at: number, delta: number): TableObj['styles'] {
  const out: TableObj['styles'] = {};
  for (const [k, v] of Object.entries(o.styles)) {
    let [r, c] = k.split(',').map(Number);
    const i = axis === 'r' ? r : c;
    if (delta < 0 && i === at) continue;
    if (i >= at + (delta < 0 ? 1 : 0)) { if (axis === 'r') r += delta; else c += delta; }
    out[cellKey(r, c)] = v;
  }
  return out;
}

function shiftMerges(o: TableObj, axis: 'r' | 'c', at: number, delta: number): TableMerge[] {
  return o.merges.flatMap((m) => {
    const start = axis === 'r' ? m.r : m.c, span = axis === 'r' ? m.rs : m.cs;
    let s = start, n = span;
    if (delta > 0) {
      if (at <= start) s += 1; else if (at < start + span) n += 1;
    } else {
      if (at < start) s -= 1; else if (at < start + span) n -= 1;
    }
    if (n < 1) return [];
    return [axis === 'r' ? { ...m, r: s, rs: n } : { ...m, c: s, cs: n }];
  });
}

export function insertRow(o: TableObj, at: number): Patch {
  const { cols } = tableSize(o);
  const cells = [...o.cells];
  cells.splice(at, 0, Array(cols).fill(''));
  const rowHeights = [...o.rowHeights];
  rowHeights.splice(at, 0, o.rowHeights[Math.max(0, at - 1)] ?? 1);
  return { cells, rowHeights, styles: shiftStyles(o, 'r', at, 1), merges: shiftMerges(o, 'r', at, 1) };
}

export function insertCol(o: TableObj, at: number): Patch {
  const cells = o.cells.map((row) => { const r = [...row]; r.splice(at, 0, ''); return r; });
  const colWidths = [...o.colWidths];
  colWidths.splice(at, 0, o.colWidths[Math.max(0, at - 1)] ?? 1);
  return { cells, colWidths, styles: shiftStyles(o, 'c', at, 1), merges: shiftMerges(o, 'c', at, 1) };
}

export function deleteRow(o: TableObj, at: number): Patch | null {
  if (o.cells.length <= 1) return null;
  return {
    cells: o.cells.filter((_, i) => i !== at), rowHeights: o.rowHeights.filter((_, i) => i !== at),
    styles: shiftStyles(o, 'r', at, -1), merges: shiftMerges(o, 'r', at, -1),
  };
}

export function deleteCol(o: TableObj, at: number): Patch | null {
  if (tableSize(o).cols <= 1) return null;
  return {
    cells: o.cells.map((row) => row.filter((_, i) => i !== at)), colWidths: o.colWidths.filter((_, i) => i !== at),
    styles: shiftStyles(o, 'c', at, -1), merges: shiftMerges(o, 'c', at, -1),
  };
}

/** Merge the rectangle spanned by two cells; existing merges it touches are absorbed. */
export function mergeCells(o: TableObj, a: { r: number; c: number }, b: { r: number; c: number }): Patch {
  let r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
  // grow to include merges that overlap the rectangle
  for (let changed = true; changed;) {
    changed = false;
    for (const m of validMerges(o)) {
      const overlaps = m.r <= r1 && m.r + m.rs - 1 >= r0 && m.c <= c1 && m.c + m.cs - 1 >= c0;
      if (!overlaps) continue;
      const nr0 = Math.min(r0, m.r), nr1 = Math.max(r1, m.r + m.rs - 1), nc0 = Math.min(c0, m.c), nc1 = Math.max(c1, m.c + m.cs - 1);
      if (nr0 !== r0 || nr1 !== r1 || nc0 !== c0 || nc1 !== c1) { r0 = nr0; r1 = nr1; c0 = nc0; c1 = nc1; changed = true; }
    }
  }
  const inside = (m: TableMerge) => m.r >= r0 && m.r <= r1 && m.c >= c0 && m.c <= c1;
  const merges = o.merges.filter((m) => !inside(m));
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > 1) merges.push({ r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1 });
  // keep the first non-empty text in reading order
  const texts: string[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (o.cells[r][c]) texts.push(o.cells[r][c]);
  const cells = o.cells.map((row, r) => row.map((v, c) => {
    if (r < r0 || r > r1 || c < c0 || c > c1) return v;
    return r === r0 && c === c0 ? texts[0] ?? '' : '';
  }));
  return { merges, cells };
}

export function unmergeAt(o: TableObj, r: number, c: number): Patch {
  return { merges: o.merges.filter((m) => !(r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs)) };
}

/** Split tab/newline separated text; a cell in double quotes may hold tabs, line breaks and "" for a quote. */
export function parseTsv(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [[]];
  const cellEnd = (from: number) => { const k = t.slice(from).search(/[\t\n]/); return k < 0 ? t.length : from + k; };
  let i = 0;
  for (;;) {
    let v = '';
    if (t[i] === '"') {
      let j = i + 1;
      for (;;) {
        const q = t.indexOf('"', j);
        if (q < 0) { v = t.slice(i); j = t.length; break; }
        if (t[q + 1] === '"') { v += t.slice(j, q) + '"'; j = q + 2; continue; }
        v += t.slice(j, q); j = q + 1; break;
      }
      const k = cellEnd(j);
      v += t.slice(j, k); i = k;
    } else {
      const k = cellEnd(i);
      v = t.slice(i, k); i = k;
    }
    rows[rows.length - 1].push(v);
    if (i >= t.length) break;
    if (t[i] === '\n') rows.push([]);
    i++;
  }
  return rows;
}

/** Paste tab/newline separated text (e.g. copied from Excel) starting at a cell, growing the table as needed. */
export function pasteGrid(o: TableObj, text: string, r0: number, c0: number): Patch {
  const lines = parseTsv(text);
  const rows = Math.max(o.cells.length, r0 + lines.length);
  const cols = Math.max(tableSize(o).cols, c0 + Math.max(...lines.map((l) => l.length)));
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const v = lines[r - r0]?.[c - c0];
    return v !== undefined ? v : o.cells[r]?.[c] ?? '';
  }));
  return {
    cells,
    rowHeights: Array.from({ length: rows }, (_, i) => o.rowHeights[i] ?? 1),
    colWidths: Array.from({ length: cols }, (_, i) => o.colWidths[i] ?? 1),
  };
}

/* ---------- ranges (on-canvas editing) ---------- */

export interface CellRange { r0: number; r1: number; c0: number; c1: number }

/** The merge covering a cell, if any. */
export function mergeAt(o: TableObj, r: number, c: number): TableMerge | undefined {
  return validMerges(o).find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
}

/** The rectangle spanned by two cells, grown to take in every merge it cuts through. */
export function cellRange(o: TableObj, a: { r: number; c: number }, b: { r: number; c: number }): CellRange {
  let r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
  const merges = validMerges(o);
  for (let changed = true; changed;) {
    changed = false;
    for (const m of merges) {
      if (m.r > r1 || m.r + m.rs - 1 < r0 || m.c > c1 || m.c + m.cs - 1 < c0) continue;
      const n = { r0: Math.min(r0, m.r), r1: Math.max(r1, m.r + m.rs - 1), c0: Math.min(c0, m.c), c1: Math.max(c1, m.c + m.cs - 1) };
      if (n.r0 !== r0 || n.r1 !== r1 || n.c0 !== c0 || n.c1 !== c1) { ({ r0, r1, c0, c1 } = n); changed = true; }
    }
  }
  return { r0, r1, c0, c1 };
}

/** Delete rows r0..r1 (at least one row stays). */
export function deleteRows(o: TableObj, r0: number, r1: number): Patch | null {
  if (r1 - r0 + 1 >= o.cells.length) return null;
  let t = o;
  for (let r = r1; r >= r0; r--) t = { ...t, ...deleteRow(t, r)! };
  return { cells: t.cells, rowHeights: t.rowHeights, styles: t.styles, merges: t.merges };
}

export function deleteCols(o: TableObj, c0: number, c1: number): Patch | null {
  if (c1 - c0 + 1 >= tableSize(o).cols) return null;
  let t = o;
  for (let c = c1; c >= c0; c--) t = { ...t, ...deleteCol(t, c)! };
  return { cells: t.cells, colWidths: t.colWidths, styles: t.styles, merges: t.merges };
}

export function clearRange(o: TableObj, g: CellRange): Patch {
  return { cells: o.cells.map((row, r) => row.map((v, c) => (r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1 ? '' : v))) };
}

/** Tab/newline separated text for the clipboard; cells with line breaks are quoted like Excel does. */
export function rangeText(o: TableObj, g: CellRange): string {
  const q = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return o.cells.slice(g.r0, g.r1 + 1).map((row) => row.slice(g.c0, g.c1 + 1).map(q).join('\t')).join('\n');
}

/** Move the line between track i-1 and i (in mm from the start) and return new weights averaging 1. */
export function moveLine(sizes: number[], i: number, at: number, min: number): number[] {
  const start = sizes.slice(0, i - 1).reduce((a, b) => a + b, 0);
  const pair = sizes[i - 1] + sizes[i];
  const a = Math.min(pair - min, Math.max(min, at - start));
  const next = [...sizes];
  next[i - 1] = a; next[i] = pair - a;
  const mean = next.reduce((x, y) => x + y, 0) / next.length;
  return next.map((v) => Math.round((v / mean) * 1000) / 1000);
}

/** Apply a style patch to every cell of a range; empty values fall back to the table's own style. */
export function styleCells(o: TableObj, g: CellRange, patch: Partial<TableCellStyle>): Patch {
  const styles = { ...o.styles };
  for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
    const k = cellKey(r, c);
    const next: TableCellStyle = { ...styles[k], ...patch };
    (Object.keys(next) as (keyof TableCellStyle)[]).forEach((key) => { if (next[key] === undefined || next[key] === '') delete next[key]; });
    if (Object.keys(next).length) styles[k] = next; else delete styles[k];
  }
  return { styles };
}

export function unmergeRange(o: TableObj, g: CellRange): Patch {
  return { merges: o.merges.filter((m) => m.r > g.r1 || m.r + m.rs - 1 < g.r0 || m.c > g.c1 || m.c + m.cs - 1 < g.c0) };
}
