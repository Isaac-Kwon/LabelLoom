import { cellKey } from './table';
import type { TableCellStyle, TableMerge, TableObj } from './types';

/** Ready-made table layouts: each builds the structural part of a table object. */

export type TableLayout = Pick<TableObj, 'cells' | 'colWidths' | 'rowHeights' | 'merges' | 'styles' | 'headerRow' | 'headerCol'>;

/* ---------- time helpers ---------- */

/** "9:00", "0900", "9" → minutes after midnight, or NaN. */
export function parseTime(s: string): number {
  const m = s.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h < 48 && mi < 60 ? h * 60 + mi : NaN;
}

export const fmtTime = (min: number) => {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

/* ---------- 요일 × 교시 ---------- */

export interface WeeklyOpts {
  days: string[];
  periods: number;
  /** add each period's clock time under its name */
  showTimes: boolean;
  start: string;
  lesson: number; // minutes
  rest: number; // minutes between periods
  /** a lunch row after this period, 0 = none */
  lunchAfter: number;
  lunch: number; // minutes
}

export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function weeklyLayout(o: WeeklyOpts): TableLayout {
  const cells: string[][] = [['', ...o.days]];
  const merges: TableMerge[] = [];
  const styles: Record<string, TableCellStyle> = {};
  let t = parseTime(o.start);
  if (!Number.isFinite(t)) t = 9 * 60;
  for (let p = 1; p <= o.periods; p++) {
    const label = o.showTimes ? `${p}교시\n${fmtTime(t)}–${fmtTime(t + o.lesson)}` : `${p}교시`;
    cells.push([label, ...o.days.map(() => '')]);
    t += o.lesson;
    if (p === o.lunchAfter && p < o.periods) {
      const r = cells.length;
      cells.push([o.showTimes ? `점심\n${fmtTime(t)}–${fmtTime(t + o.lunch)}` : '점심', '점심시간', ...o.days.slice(1).map(() => '')]);
      if (o.days.length > 1) merges.push({ r, c: 1, rs: 1, cs: o.days.length });
      styles[cellKey(r, 1)] = { fill: '#f1f5f9', color: '#475569' };
      t += o.lunch;
    } else t += o.rest;
  }
  return {
    cells, merges, styles, headerRow: true, headerCol: true,
    colWidths: cells[0].map((_, c) => (c === 0 ? (o.showTimes ? 1.5 : 1.1) : 1)),
    rowHeights: cells.map((row, r) => (r === 0 ? 0.8 : row[1] === '점심시간' ? 0.6 : 1)),
  };
}

/* ---------- 학술대회 시간표 ---------- */

/**
 * session: one cell per track (parallel sessions in each room/day),
 * plenary: one cell across every track (keynote, opening),
 * break: across every track, shaded (coffee break, lunch).
 */
export type BlockKind = 'session' | 'plenary' | 'break';

export interface ProgramBlock { start: string; end: string; kind: BlockKind; title: string }

export interface ProgramOpts {
  tracks: string[];
  blocks: ProgramBlock[];
  /** row heights follow each block's duration */
  proportional: boolean;
  breakFill: string;
}

export const DEFAULT_BLOCKS: ProgramBlock[] = [
  { start: '09:00', end: '10:30', kind: 'session', title: 'Session 1' },
  { start: '10:30', end: '11:00', kind: 'break', title: 'Coffee Break' },
  { start: '11:00', end: '12:30', kind: 'session', title: 'Session 2' },
  { start: '12:30', end: '14:00', kind: 'break', title: 'Lunch' },
  { start: '14:00', end: '15:30', kind: 'session', title: 'Session 3' },
];

export const blockMinutes = (b: ProgramBlock) => {
  const d = parseTime(b.end) - parseTime(b.start);
  return Number.isFinite(d) && d > 0 ? d : 60;
};

export function programLayout(o: ProgramOpts): TableLayout {
  const tracks = o.tracks.length ? o.tracks : [''];
  const n = tracks.length;
  const cells: string[][] = [['시간', ...tracks]];
  const merges: TableMerge[] = [];
  const styles: Record<string, TableCellStyle> = {};
  const heights = [0];
  for (const b of o.blocks) {
    const r = cells.length;
    const time = `${b.start}–${b.end}`;
    if (b.kind === 'session' && n > 1) {
      // parallel sessions: the session name goes with the time, each room's cell stays open
      cells.push([b.title ? `${time}\n${b.title}` : time, ...tracks.map(() => '')]);
    } else {
      cells.push([time, b.title, ...tracks.slice(1).map(() => '')]);
      if (n > 1) merges.push({ r, c: 1, rs: 1, cs: n });
    }
    if (b.kind === 'break') {
      styles[cellKey(r, 0)] = { fill: o.breakFill, color: '#475569' };
      styles[cellKey(r, 1)] = { fill: o.breakFill, color: '#475569' };
    }
    if (b.kind === 'plenary') styles[cellKey(r, 1)] = { bold: true };
    heights.push(o.proportional ? blockMinutes(b) : b.kind === 'break' ? 0.6 : 1);
  }
  // the header row is as tall as a short block
  const body = heights.slice(1);
  const avg = body.length ? body.reduce((a, b) => a + b, 0) / body.length : 1;
  heights[0] = o.proportional ? Math.max(15, avg * 0.35) : 0.7;
  if (o.proportional) {
    // a 15-minute break still needs room for its text
    const floor = Math.max(...body, 1) * 0.28;
    for (let i = 1; i < heights.length; i++) heights[i] = Math.max(heights[i], floor);
  }
  return {
    cells, merges, styles, headerRow: true, headerCol: true,
    colWidths: [n > 1 ? 1.1 : 0.9, ...tracks.map(() => (n > 1 ? 1 : 2.2))],
    rowHeights: heights,
  };
}

/* ---------- 빈 표 ---------- */

export function blankLayout(rows: number, cols: number, headerRow: boolean, headerCol: boolean): TableLayout {
  return {
    cells: Array.from({ length: rows }, () => Array(cols).fill('')),
    colWidths: Array(cols).fill(1), rowHeights: Array(rows).fill(1),
    merges: [], styles: {}, headerRow, headerCol,
  };
}
