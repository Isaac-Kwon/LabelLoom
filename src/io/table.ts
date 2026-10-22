import * as XLSX from 'xlsx';
import { newRow } from '../model/defaults';
import type { DataTable, Row } from '../model/types';
import { download } from './export';

export interface ParsedSheet { sheetNames: string[]; sheet: string; grid: string[][]; merged: number }

export async function readTableFile(file: File, sheet?: string): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const isText = /\.(csv|tsv|txt)$/i.test(file.name);
  const wb = isText
    ? XLSX.read(decodeText(new Uint8Array(buf)), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array', cellDates: true });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
    .map((r) => r.map((c) => (c == null ? '' : String(c))));
  return { sheetNames: wb.SheetNames, sheet: name, grid, merged: ws['!merges']?.length ?? 0 };
}

/** CSV files from Korean Excel are often CP949; fall back when UTF-8 decoding fails. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('euc-kr').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  }
}

export interface ImportOptions {
  headerRow: number; // 0-based
  trim: boolean;
  /** source header -> target column name ('' = skip) */
  mapping: Record<string, string>;
  copiesColumn?: string;
}

export function gridToRows(grid: string[][], o: ImportOptions): { columns: string[]; rows: Row[] } {
  const header = (grid[o.headerRow] ?? []).map((h, i) => h.trim() || `열${i + 1}`);
  const columns: string[] = [];
  header.forEach((h) => { const t = o.mapping[h] ?? h; if (t && t !== o.copiesColumn && !columns.includes(t)) columns.push(t); });
  const rows = grid.slice(o.headerRow + 1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const values: Record<string, string> = {};
      let copies = 1;
      header.forEach((h, i) => {
        const v = o.trim ? (r[i] ?? '').trim().replace(/\s+/g, ' ') : r[i] ?? '';
        if (o.copiesColumn && h === o.copiesColumn) { copies = Math.max(0, parseInt(v, 10) || 1); return; }
        const t = o.mapping[h] ?? h;
        if (t) values[t] = values[t] ? `${values[t]} ${v}`.trim() : v;
      });
      return { ...newRow(values), copies };
    });
  return { columns, rows };
}

export function mergeTable(cur: DataTable, add: { columns: string[]; rows: Row[] }, mode: 'replace' | 'append'): DataTable {
  if (mode === 'replace') return { columns: add.columns, rows: add.rows };
  return { columns: [...new Set([...cur.columns, ...add.columns])], rows: [...cur.rows, ...add.rows] };
}

export function exportTable(t: DataTable, format: 'xlsx' | 'csv', name: string, withMeta = true) {
  const head = withMeta ? ['인쇄', '매수', '인쇄일시', ...t.columns] : t.columns;
  const body = t.rows.map((r) => {
    const vals = t.columns.map((c) => r.values[c] ?? '');
    return withMeta ? [r.print ? 'Y' : 'N', r.copies, r.printed ? new Date(r.printed).toLocaleString() : '', ...vals] : vals;
  });
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  if (format === 'csv') {
    download(new Blob(['﻿' + XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
  }
}

/** Re-import metadata columns written by exportTable. */
export function absorbMeta(rows: Row[]): Row[] {
  return rows.map((r) => {
    const v = { ...r.values };
    let { print, copies, printed } = r;
    if ('인쇄' in v) { print = !/^(n|no|false|0|x)$/i.test(v['인쇄'].trim()); delete v['인쇄']; }
    if ('매수' in v) { copies = Math.max(0, parseInt(v['매수'], 10) || 1); delete v['매수']; }
    if ('인쇄일시' in v) { const d = Date.parse(v['인쇄일시']); printed = Number.isNaN(d) ? undefined : new Date(d).toISOString(); delete v['인쇄일시']; }
    return { ...r, values: v, print, copies, printed };
  });
}

/* ---------- attendee header synonyms ---------- */

export const SYNONYMS: string[][] = [
  ['이름', '성명', '성함', 'name', 'full name', 'fullname', '참가자', '참석자', '이름(한글)'],
  ['영문이름', '영문명', '영문 이름', 'english name', 'name (english)', 'name_en'],
  ['소속', '기관', '소속기관', '회사', '학교', 'affiliation', 'organization', 'organisation', 'company', 'institution'],
  ['직함', '직위', '직책', '직급', 'title', 'position', 'job title'],
  ['부서', '학과', 'department', 'dept'],
  ['참가구분', '구분', '등록구분', '참가유형', '유형', 'type', 'category', 'role', 'registration type'],
  ['ID', '등록번호', '참가번호', '접수번호', '번호', 'id', 'registration no', 'reg no', 'reg. no', 'number', 'no'],
  ['이메일', '메일', '전자우편', 'email', 'e-mail', 'mail'],
  ['연락처', '전화', '휴대폰', '전화번호', 'phone', 'mobile', 'tel'],
  ['국가', '나라', 'country', 'nation'],
];

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.()]/g, '');

/** Suggest a mapping from imported headers to the design's columns. */
export function suggestMapping(headers: string[], targets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const nh = norm(h);
    let hit = targets.find((t) => norm(t) === nh);
    if (!hit) {
      const group = SYNONYMS.find((g) => g.some((x) => norm(x) === nh));
      if (group) hit = targets.find((t) => group.some((x) => norm(x) === norm(t)));
    }
    out[h] = hit ?? h;
  }
  return out;
}

/** Ids of rows sharing the same key with another row. */
export function findDuplicates(rows: Row[], keys: string[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const k = keys.map((c) => (r.values[c] ?? '').trim().toLowerCase()).join('\u0001');
    if (!k.replace(/\u0001/g, '')) continue;
    seen.set(k, [...(seen.get(k) ?? []), r.id]);
  }
  const dup = new Set<string>();
  seen.forEach((ids) => ids.length > 1 && ids.forEach((id) => dup.add(id)));
  return dup;
}
