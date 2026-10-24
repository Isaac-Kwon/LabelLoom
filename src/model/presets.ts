import type { Paper } from './types';

const A4 = { width: 210, height: 297 };
const LETTER = { width: 215.9, height: 279.4 };

export function makePaper(p: Partial<Paper> & Pick<Paper, 'name' | 'width' | 'height' | 'labelWidth' | 'labelHeight'>): Paper {
  return {
    cornerRadius: 0, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0,
    safeMargin: 1.5, bleed: 0, dpi: 300, labelColor: '#ffffff',
    ...p,
  };
}

/** A sheet with the label grid centred on the page. */
export function sheet(name: string, page: { width: number; height: number }, lw: number, lh: number,
  cols: number, rows: number, gapX = 0, gapY = 0, cornerRadius = 0): Paper {
  return makePaper({
    name, ...page, labelWidth: lw, labelHeight: lh, cols, rows, gapX, gapY, cornerRadius,
    ...centerGrid(page.width, page.height, lw, lh, cols, rows, gapX, gapY),
  });
}

export function roll(name: string, w: number, h: number, cornerRadius = 0): Paper {
  return makePaper({ name, width: w, height: h, labelWidth: w, labelHeight: h, cornerRadius, safeMargin: 1 });
}

/**
 * A label of any size: a single sheet of that size, or as many as fit on an A4/Letter
 * page with `gap` between them and at least `margin` from the page edge.
 */
export function customPaper(lw: number, lh: number, page: 'roll' | 'A4' | 'Letter', gap = 0, margin = 5): Paper {
  const name = `${fmt(lw)}×${fmt(lh)}`;
  if (page === 'roll') return roll(name, lw, lh);
  const pg = page === 'A4' ? A4 : LETTER;
  const fit = (avail: number, unit: number) => Math.max(1, Math.floor((avail + gap + 1e-6) / (unit + gap)));
  const cols = fit(pg.width - 2 * margin, lw), rows = fit(pg.height - 2 * margin, lh);
  return sheet(`${page} ${cols}×${rows} (${name})`, pg, lw, lh, cols, rows, gap, gap);
}

export function centerGrid(pw: number, ph: number, lw: number, lh: number, cols: number, rows: number, gx: number, gy: number) {
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    marginLeft: r((pw - (cols * lw + (cols - 1) * gx)) / 2),
    marginTop: r((ph - (rows * lh + (rows - 1) * gy)) / 2),
  };
}

export const PAPER_PRESETS: { group: string; items: Paper[] }[] = [
  {
    group: 'A4 라벨지',
    items: [
      sheet('A4 3×7 (63.5×38.1)', A4, 63.5, 38.1, 3, 7, 2.5, 0, 2),
      sheet('A4 3×8 (63.5×33.9)', A4, 63.5, 33.9, 3, 8, 2.5, 0, 2),
      sheet('A4 2×7 (99.1×38.1)', A4, 99.1, 38.1, 2, 7, 2.5, 0, 2),
      sheet('A4 2×8 (99.1×33.9)', A4, 99.1, 33.9, 2, 8, 2.5, 0, 2),
      sheet('A4 4×10 (48.5×25.4)', A4, 48.5, 25.4, 4, 10, 0, 0),
      sheet('A4 5×13 (38.1×21.2)', A4, 38.1, 21.2, 5, 13, 2.5, 0, 1),
      sheet('A4 4×6 (45×45)', A4, 45, 45, 4, 6, 3, 3, 3),
      sheet('A4 원형 4×6 (Ø40)', A4, 40, 40, 4, 6, 7, 7, 20),
      sheet('A4 원형 3×4 (Ø60)', A4, 60, 60, 3, 4, 6, 8, 30),
      sheet('A4 2×2 (105×148.5)', A4, 105, 148.5, 2, 2),
      sheet('A4 1칸 (전체)', A4, 210, 297, 1, 1),
    ],
  },
  {
    group: '명찰·행사',
    items: [
      sheet('A4 명찰 2×5 (90×55)', A4, 90, 55, 2, 5),
      sheet('A4 명찰 2×4 (90×60)', A4, 90, 60, 2, 4, 5, 5),
      sheet('A4 명찰 2×3 (100×70)', A4, 100, 70, 2, 3, 5, 10),
      roll('명찰 단면 90×55', 90, 55, 3),
      roll('명찰 100×70', 100, 70, 3),
      roll('목걸이 명찰 A6 (105×148)', 105, 148),
      makePaper({ name: '테이블 네임텐트 (A4 가로)', width: 297, height: 210, labelWidth: 297, labelHeight: 210, safeMargin: 5 }),
      makePaper({ name: '테이블 네임텐트 (Letter 가로)', width: 279.4, height: 215.9, labelWidth: 279.4, labelHeight: 215.9, safeMargin: 5 }),
    ],
  },
  {
    group: '롤 라벨 (라벨 프린터)',
    items: [
      roll('50×30', 50, 30, 1.5),
      roll('40×20', 40, 20, 1.5),
      roll('30×20', 30, 20, 1.5),
      roll('60×40', 60, 40, 1.5),
      roll('100×50', 100, 50),
      roll('택배 100×150', 100, 150),
      roll('정사각 40×40', 40, 40, 1.5),
      roll('원형 Ø40', 40, 40, 20),
    ],
  },
  {
    group: 'Letter',
    items: [
      sheet('Letter 3×10 (66.7×25.4)', LETTER, 66.7, 25.4, 3, 10, 3.2, 0, 1.5),
      sheet('Letter 2×5 (101.6×50.8)', LETTER, 101.6, 50.8, 2, 5, 4.8, 0, 1.5),
    ],
  },
];

/** A built-in preset by name; throws so a typo in a template shows up immediately. */
export function preset(name: string): Paper {
  for (const g of PAPER_PRESETS) {
    const p = g.items.find((x) => x.name === name);
    if (p) return { ...p };
  }
  throw new Error(`unknown paper preset: ${name}`);
}

export type PaperKind = 'A4' | 'Letter' | 'roll';
export const PAPER_KIND_LABEL: Record<PaperKind, string> = { A4: 'A4 시트', Letter: 'Letter 시트', roll: '롤·낱장' };

export function paperKind(p: Paper): PaperKind {
  const is = (a: number, b: number) => (Math.abs(p.width - a) < 1 && Math.abs(p.height - b) < 1) || (Math.abs(p.width - b) < 1 && Math.abs(p.height - a) < 1);
  return is(A4.width, A4.height) ? 'A4' : is(LETTER.width, LETTER.height) ? 'Letter' : 'roll';
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);
/** Label size key such as "90×55"; round labels read "Ø40". */
export function labelSize(p: Paper): string {
  return p.labelWidth === p.labelHeight && p.cornerRadius * 2 >= p.labelWidth ? `Ø${fmt(p.labelWidth)}` : `${fmt(p.labelWidth)}×${fmt(p.labelHeight)}`;
}

const PRESET_KEY = 'labelloom.paperPresets';

export function loadUserPresets(): Paper[] {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
}
export function saveUserPresets(list: Paper[]) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}
