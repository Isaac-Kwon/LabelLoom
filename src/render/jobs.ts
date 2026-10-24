import { getLang, t } from '../i18n';
import { newObject } from '../model/defaults';
import type { Design, DuplexSettings, LabelObject, Project, Row } from '../model/types';
import { pickDesign, type ResolveCtx } from './resolve';
import { sheetLayout, type Fold, type SheetCell } from './svg';

export type Scope = 'checked' | 'all' | 'filtered' | 'range' | 'unprinted' | 'current';

export interface JobOptions {
  scope: Scope;
  rangeFrom: number; // 1-based, inclusive
  rangeTo: number;
  filteredIds?: Set<string>;
  currentRow: number;
  /** multiplies each row's copies */
  copies: number;
  /** count when the table is empty */
  blankCount: number;
  /** 1-based cell where the first sheet starts */
  startCell: number;
  duplex: boolean;
  /** sheets: back on its own sheet (needs printer alignment) · fold: front and back side by side, folded after cutting */
  duplexMode: 'sheets' | 'fold';
  mirror: 'cols' | 'rows';
  foldDir: 'right' | 'below';
  foldRotate: boolean;
}

export const DEFAULT_DUPLEX: Pick<JobOptions, 'duplex' | 'duplexMode' | 'mirror' | 'foldDir' | 'foldRotate'> = {
  duplex: false, duplexMode: 'sheets', mirror: 'cols', foldDir: 'right', foldRotate: false,
};

/** Fold settings for the renderer, or null when not fold-printing. */
export const jobFold = (o: Pick<JobOptions, 'duplex' | 'duplexMode' | 'foldDir' | 'foldRotate'>): Fold | null =>
  o.duplex && o.duplexMode === 'fold' ? { dir: o.foldDir, rotate: o.foldRotate } : null;

/** Duplex options from the project, falling back to the browser's last export settings. */
export function projectDuplex(p: Project, saved: Partial<Record<'duplexMode' | 'foldDir' | 'foldRotate', unknown>> = {}): DuplexSettings {
  const d = p.duplex;
  return {
    mode: d?.mode ?? (saved.duplexMode as DuplexSettings['mode']) ?? DEFAULT_DUPLEX.duplexMode,
    mirror: d?.mirror ?? DEFAULT_DUPLEX.mirror,
    foldDir: d?.foldDir ?? (saved.foldDir as DuplexSettings['foldDir']) ?? DEFAULT_DUPLEX.foldDir,
    foldRotate: d?.foldRotate ?? (saved.foldRotate as boolean) ?? DEFAULT_DUPLEX.foldRotate,
  };
}

/** The same project on a page exactly one label in size (label printers, single reprints). */
export const labelSizeProject = (p: Project): Project => ({
  ...p, paper: { ...p.paper, width: p.paper.labelWidth, height: p.paper.labelHeight, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0 },
});

export interface JobItem {
  row?: Row;
  rowIndex: number;
  copy: number;
  seq: number;
  design: Design;
  /** start a new sheet with this item */
  breakBefore?: boolean;
  /** a divider label naming the group that follows (not a data row) */
  separator?: string;
}

export interface GroupOptions {
  /** '' = no grouping */
  column: string;
  newSheet: boolean;
  separator: boolean;
}

/**
 * Items sorted into groups by the value of `column` (natural order, empty values last), keeping
 * the order inside each group. Serial numbers follow the new order. Each group can start on a
 * new sheet and be preceded by a divider label with its name and count.
 */
export function groupItems(p: Project, items: JobItem[], g: GroupOptions): JobItem[] {
  if (!g.column || !p.data.rows.length) return items;
  const coll = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' });
  const groups = new Map<string, JobItem[]>();
  for (const it of items) {
    const k = (it.row?.values[g.column] ?? '').trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : coll.compare(a, b)));
  const out: JobItem[] = [];
  let seq = p.seqStart;
  keys.forEach((k, gi) => {
    const list = groups.get(k)!;
    const brk = g.newSheet && gi > 0;
    if (g.separator) out.push(separatorItem(p, g.column, k, list.length, brk));
    list.forEach((it, i) => out.push({ ...it, seq: seq++, breakBefore: !g.separator && brk && i === 0 }));
  });
  return out;
}

function separatorItem(p: Project, column: string, value: string, count: number, breakBefore: boolean): JobItem {
  const { labelWidth: W, labelHeight: H } = p.paper;
  const m = Math.min(W, H) * 0.08;
  const text = (y: number, h: number, content: string, size: number, bold: boolean) =>
    ({ ...newObject('text', m, y, W - 2 * m, h), content, fontSize: size, minFontSize: 4, bold, align: 'center', multiline: true }) as LabelObject;
  const frame = { ...newObject('rect', m / 2, m / 2, W - m, H - m), fill: { type: 'none' }, dash: true, strokeWidth: 0.3 } as LabelObject;
  const objects = [
    frame,
    text(m, H * 0.2, column, 9, false),
    text(m + H * 0.2, H * 0.45, '{{__group}}', 28, true),
    text(H * 0.68, H * 0.2, '{{__count}}', 10, false),
  ];
  const row: Row = { id: '', print: false, copies: 1, values: { __group: value || t('(빈 값)'), __count: t('{n}장', { n: count }) } };
  return { row, rowIndex: -1, copy: 1, seq: 0, design: { id: `separator:${value}`, name: '', objects }, separator: value, breakBefore };
}

export function selectRows(p: Project, o: Pick<JobOptions, 'scope' | 'rangeFrom' | 'rangeTo' | 'filteredIds' | 'currentRow'>): { row: Row; index: number }[] {
  const all = p.data.rows.map((row, index) => ({ row, index }));
  switch (o.scope) {
    case 'all': return all;
    case 'checked': return all.filter((x) => x.row.print);
    case 'filtered': return all.filter((x) => o.filteredIds?.has(x.row.id) && x.row.print);
    case 'range': return all.filter((x) => x.index + 1 >= o.rangeFrom && x.index + 1 <= o.rangeTo);
    case 'unprinted': return all.filter((x) => x.row.print && !x.row.printed);
    case 'current': return all.filter((x) => x.index === o.currentRow);
  }
}

export function buildItems(p: Project, o: JobOptions): JobItem[] {
  const items: JobItem[] = [];
  let seq = p.seqStart;
  if (!p.data.rows.length) {
    for (let i = 0; i < Math.max(1, o.blankCount); i++) items.push({ rowIndex: i, copy: 1, seq: seq++, design: p.designs[0] });
    return items;
  }
  for (const { row, index } of selectRows(p, o)) {
    const design = pickDesign(p, row);
    const n = Math.max(0, Math.round(row.copies)) * Math.max(1, o.copies);
    for (let c = 1; c <= n; c++) items.push({ row, rowIndex: index, copy: c, seq: seq++, design });
  }
  return items;
}

export interface Page { cells: (SheetCell | null)[]; back?: boolean; items: JobItem[] }

export function paginate(p: Project, items: JobItem[], o: Pick<JobOptions, 'startCell' | 'duplex'> & { fold?: Fold | null }, now = new Date()): Page[] {
  if (o.fold) return paginateFold(p, items, o.startCell, o.fold, now);
  const per = p.paper.cols * p.paper.rows;
  const pages: Page[] = [];
  let cells: (SheetCell | null)[] = [];
  let pageItems: JobItem[] = [];
  const skip = Math.min(per - 1, Math.max(0, o.startCell - 1));
  for (let i = 0; i < skip; i++) cells.push(null);
  const flush = () => {
    while (cells.length < per) cells.push(null);
    const pageNo = pages.filter((x) => !x.back).length + 1;
    pages.push({ cells, items: pageItems });
    if (o.duplex) {
      const backs = cells.map((c, i) => {
        if (!c) return null;
        const it = cellItem.get(i)!;
        return it.design.back?.length ? { objects: it.design.back, ctx: { ...c.ctx, page: pageNo } } : null;
      });
      pages.push({ cells: backs, back: true, items: pageItems });
    }
    cells = []; pageItems = []; cellItem.clear();
  };
  const cellItem = new Map<number, JobItem>();
  items.forEach((it) => {
    if (it.breakBefore && cells.some(Boolean)) flush();
    const pageNo = pages.filter((x) => !x.back).length + 1;
    const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: it.copy, page: pageNo, now };
    cellItem.set(cells.length, it);
    cells.push({ objects: it.design.objects, ctx });
    pageItems.push(it);
    if (cells.length >= per) flush();
  });
  if (cells.some(Boolean)) flush();
  return pages;
}

/** Fold printing: each cell carries its back, all on one side of the sheet. */
function paginateFold(p: Project, items: JobItem[], startCell: number, fold: Fold, now: Date): Page[] {
  const L = sheetLayout(p.paper, fold);
  const per = L.cols * L.rows;
  const pages: Page[] = [];
  let cells: (SheetCell | null)[] = Array(Math.min(per - 1, Math.max(0, startCell - 1))).fill(null);
  let pageItems: JobItem[] = [];
  const flush = () => {
    while (cells.length < per) cells.push(null);
    pages.push({ cells, items: pageItems });
    cells = []; pageItems = [];
  };
  for (const it of items) {
    if (it.breakBefore && cells.some(Boolean)) flush();
    const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: it.copy, page: pages.length + 1, now };
    cells.push({ objects: it.design.objects, ctx, back: it.design.back?.length ? { objects: it.design.back, ctx } : null });
    pageItems.push(it);
    if (cells.length >= per) flush();
  }
  if (cells.some(Boolean)) flush();
  return pages;
}
