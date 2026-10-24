import * as XLSX from 'xlsx';
import { everyLang, m, t } from '../i18n';
import { newRow } from '../model/defaults';
import type { DataTable, Row } from '../model/types';
import { download } from './export';

export interface ParsedSheet { sheetNames: string[]; sheet: string; grid: string[][]; merged: number }

export async function readTableFile(file: File, sheet?: string): Promise<ParsedSheet> {
  return parseTable(new Uint8Array(await file.arrayBuffer()), /\.(csv|tsv|txt)$/i.test(file.name), sheet);
}

/** Fetch a CSV or spreadsheet from a server. The server must allow cross-origin requests (CORS). */
export async function fetchTable(url: string, sheet?: string): Promise<ParsedSheet> {
  let res: Response;
  try {
    res = await fetch(sourceUrl(url), { cache: 'no-store' });
  } catch {
    throw new Error(t('서버에 연결할 수 없습니다. 주소와 인터넷 연결을 확인하고, 서버가 다른 사이트의 요청(CORS)을 허용하는지 확인하세요.'));
  }
  if (!res.ok) throw new Error(t('서버 응답 오류: {status}', { status: `${res.status} ${res.statusText}`.trim() }));
  const bytes = new Uint8Array(await res.arrayBuffer());
  // xlsx/ods are ZIPs (PK), xls is an OLE file; anything else is read as text
  const binary = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
  if (!binary && /^\s*<(!doctype|html)/i.test(new TextDecoder().decode(bytes.slice(0, 200)))) {
    throw new Error(t('표 대신 웹 페이지가 왔습니다. CSV 파일로 바로 받아지는 주소인지, 로그인 없이 열리는지 확인하세요.'));
  }
  return parseTable(bytes, !binary, sheet);
}

/** Google Sheets page links → their CSV export; other URLs as they are. */
export function sourceUrl(url: string): string {
  const u = url.trim();
  const g = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/?(?:(?:edit|view|htmlview)\b.*)?(?:[?#].*)?$/);
  if (g && g[1] !== 'e') {
    const gid = u.match(/[#?&]gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${g[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  }
  const pub = u.match(/^(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[\w-]+)\/pubhtml(?:\?(.*))?$/);
  if (pub) return `${pub[1]}/pub?${pub[2] ? pub[2] + '&' : ''}output=csv`;
  return u;
}

function parseTable(bytes: Uint8Array, isText: boolean, sheet?: string): ParsedSheet {
  const wb = isText
    ? XLSX.read(decodeText(bytes), { type: 'string', raw: true })
    : XLSX.read(bytes, { type: 'array', cellDates: true });
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
  const header = (grid[o.headerRow] ?? []).map((h, i) => h.trim() || t('열{n}', { n: i + 1 }));
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

/**
 * Merge rows fetched again from a data source. A row whose key matches an existing row takes its new
 * values (print check, copies and print history stay); new keys are appended; rows missing from the
 * source are kept. Without a key, or with an empty key cell, the whole row is the key.
 */
export function syncTable(cur: DataTable, add: { columns: string[]; rows: Row[] }, key: string, takeCopies: boolean) {
  const keyOf = (r: Row) => {
    const k = key && (r.values[key] ?? '').trim().toLowerCase();
    return k ? 'k' + k : 'v' + add.columns.map((c) => (r.values[c] ?? '').trim()).join('\u0001');
  };
  const pool = new Map<string, number[]>();
  cur.rows.forEach((r, i) => { const k = keyOf(r); pool.set(k, [...(pool.get(k) ?? []), i]); });
  const rows = [...cur.rows];
  let added = 0, updated = 0;
  for (const r of add.rows) {
    const i = pool.get(keyOf(r))?.shift();
    if (i === undefined) { rows.push(r); added++; continue; }
    const old = rows[i];
    const copies = takeCopies ? r.copies : old.copies;
    if (copies === old.copies && add.columns.every((c) => (old.values[c] ?? '') === (r.values[c] ?? ''))) continue;
    rows[i] = { ...old, values: { ...old.values, ...r.values }, copies };
    updated++;
  }
  const columns = [...new Set([...cur.columns, ...add.columns])];
  const table = added || updated || columns.length !== cur.columns.length ? { columns, rows } : cur;
  return { table, added, updated };
}

/** A column that identifies a person (ID, then e-mail), to match rows when a data source is refreshed. */
export function guessKey(columns: string[]): string {
  for (const g of [SYNONYMS[6], SYNONYMS[7]]) {
    const hit = columns.find((c) => g.some((x) => norm(x) === norm(c)));
    if (hit) return hit;
  }
  return '';
}

/** Columns exportTable adds in front of the data; read back in any UI language. */
const META = { print: m('인쇄'), copies: m('매수'), printed: m('인쇄일시') };
const metaKey = (v: Record<string, string>, k: keyof typeof META) => everyLang(META[k]).find((n) => n in v);
export const isMetaColumn = (c: string) => Object.values(META).some((k) => everyLang(k).includes(c));

const pad2 = (n: number) => String(n).padStart(2, '0');
const localStamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function exportTable(tbl: DataTable, format: 'xlsx' | 'csv', name: string, withMeta = true) {
  const head = withMeta ? [t(META.print), t(META.copies), t(META.printed), ...tbl.columns] : tbl.columns;
  const body = tbl.rows.map((r) => {
    const vals = tbl.columns.map((c) => r.values[c] ?? '');
    // ISO-like local time, so it reads back the same whatever the language
    return withMeta ? [r.print ? 'Y' : 'N', r.copies, r.printed ? localStamp(new Date(r.printed)) : '', ...vals] : vals;
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
    const p = metaKey(v, 'print'), c = metaKey(v, 'copies'), d = metaKey(v, 'printed');
    if (p) { print = !/^(n|no|false|0|x)$/i.test(v[p].trim()); delete v[p]; }
    if (c) { copies = Math.max(0, parseInt(v[c], 10) || 1); delete v[c]; }
    if (d) { const ms = Date.parse(v[d]); printed = Number.isNaN(ms) ? undefined : new Date(ms).toISOString(); delete v[d]; }
    return { ...r, values: v, print, copies, printed };
  });
}

/* ---------- attendee header synonyms ---------- */

export const SYNONYMS: string[][] = [
  ['이름', '성명', '성함', 'name', 'full name', 'fullname', '참가자', '참석자', '이름(한글)', 'nome', 'nome e cognome', 'nominativo', 'partecipante', 'nom', 'nom complet', 'prénom et nom', 'participant'],
  ['영문이름', '영문명', '영문 이름', 'english name', 'name (english)', 'name_en'],
  ['소속', '기관', '소속기관', '회사', '학교', 'affiliation', 'organization', 'organisation', 'company', 'institution', 'affiliazione', 'ente', 'istituzione', 'azienda', 'università', 'établissement', 'entreprise', 'société', 'université'],
  ['직함', '직위', '직책', '직급', 'title', 'position', 'job title', 'qualifica', 'titolo', 'posizione', 'fonction', 'titre', 'poste'],
  ['부서', '학과', 'department', 'dept', 'dipartimento', 'reparto', 'ufficio', 'département', 'service'],
  ['참가구분', '구분', '등록구분', '참가유형', '유형', 'type', 'category', 'role', 'registration type', 'ruolo', 'tipo', 'categoria', 'rôle', 'catégorie'],
  ['ID', '등록번호', '참가번호', '접수번호', '번호', 'id', 'registration no', 'reg no', 'reg. no', 'number', 'no', 'numero', 'n.', 'numéro', 'n°'],
  ['이메일', '메일', '전자우편', 'email', 'e-mail', 'mail', 'posta elettronica', 'courriel', 'adresse e-mail'],
  ['연락처', '전화', '휴대폰', '전화번호', 'phone', 'mobile', 'tel', 'telefono', 'cellulare', 'téléphone', 'portable'],
  ['국가', '나라', 'country', 'nation', 'paese', 'nazione', 'pays'],
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
