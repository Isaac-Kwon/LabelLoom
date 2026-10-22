import type { Design, Project, Row } from '../model/types';
import { pickDesign, type ResolveCtx } from './resolve';
import type { SheetCell } from './svg';

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
  mirror: 'cols' | 'rows';
}

export interface JobItem {
  row?: Row;
  rowIndex: number;
  copy: number;
  seq: number;
  design: Design;
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

export function paginate(p: Project, items: JobItem[], o: Pick<JobOptions, 'startCell' | 'duplex'>, now = new Date()): Page[] {
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
