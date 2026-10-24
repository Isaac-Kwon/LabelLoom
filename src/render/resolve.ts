import { m, type Msg } from '../i18n';
import type { Design, LabelObject, Project, Row, RuleOp } from '../model/types';
import { plainText, protectValue } from './rich';

export interface ResolveCtx {
  row?: Row;
  rowIndex: number; // 0-based position in the table
  seq: number; // global print counter
  copy: number; // 1-based copy number of this row
  page: number; // 1-based sheet number
  now: Date;
}

export const previewCtx = (row: Row | undefined, rowIndex: number, seqStart = 1): ResolveCtx => ({
  row, rowIndex, seq: seqStart + Math.max(0, rowIndex), copy: 1, page: 1, now: new Date(),
});

const CONTROL: Record<string, string> = { GS: '\x1d', RS: '\x1e', EOT: '\x04', FS: '\x1c', US: '\x1f', CR: '\r', LF: '\n', TAB: '\t' };

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function formatDate(d: Date, fmt: string): string {
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MM/g, pad(d.getMonth() + 1, 2))
    .replace(/DD/g, pad(d.getDate(), 2))
    .replace(/HH/g, pad(d.getHours(), 2))
    .replace(/mm/g, pad(d.getMinutes(), 2))
    .replace(/ss/g, pad(d.getSeconds(), 2));
}

function formatNumber(n: number, fmt?: string): string {
  if (!fmt) return String(n);
  if (/^0+$/.test(fmt)) return n < 0 ? '-' + pad(-n, fmt.length) : pad(n, fmt.length);
  return String(n);
}

/**
 * Template syntax:
 *   {{열 이름}}            column value
 *   {{#seq}} {{#seq:0000}}  print counter (also #row, #copy, #page)
 *   {{@date:YYYY-MM-DD}} {{@time:HH:mm}}
 *   {{^GS}}                 control characters (GS, RS, EOT, FS, US, CR, LF, TAB)
 *   {{이름|upper|left:10}}  value filters after "|", applied left to right (FILTERS below);
 *                           "\|" and "\:" stand for | and : inside arguments
 * `protect` is applied to every substituted value (rich text keeps markup in values literal).
 */
export function resolveTemplate(tpl: string, ctx: ResolveCtx, protect?: (v: string) => string): string {
  if (!tpl || tpl.indexOf('{{') < 0) return tpl ?? '';
  return tpl.replace(/\{\{([^{}]*)\}\}/g, (_, raw: string) => {
    // a column whose name has a "|" in it still reads as that column
    const whole = raw.trim();
    if (ctx.row && whole in ctx.row.values) return protect ? protect(ctx.row.values[whole]) : ctx.row.values[whole];
    const [head, ...filters] = splitPipes(raw);
    let v = token(head.trim(), ctx);
    for (const f of filters) v = applyFilter(v, f);
    return protect ? protect(v) : v;
  });
}

function token(tok: string, ctx: ResolveCtx): string {
  if (tok.startsWith('#')) {
    const [name, fmt] = tok.slice(1).split(':');
    const v = name === 'seq' ? ctx.seq : name === 'row' ? ctx.rowIndex + 1 : name === 'copy' ? ctx.copy : name === 'page' ? ctx.page : NaN;
    return Number.isNaN(v) ? '' : formatNumber(v, fmt);
  }
  if (tok.startsWith('@')) {
    const [name, ...rest] = tok.slice(1).split(':');
    const fmt = rest.join(':');
    if (name === 'date') return formatDate(ctx.now, fmt || 'YYYY-MM-DD');
    if (name === 'time') return formatDate(ctx.now, fmt || 'HH:mm');
    if (name === 'now') return formatDate(ctx.now, fmt || 'YYYY-MM-DD HH:mm');
    return '';
  }
  if (tok.startsWith('^')) return CONTROL[tok.slice(1).toUpperCase()] ?? '';
  return ctx.row?.values[tok] ?? '';
}

/** Splits a token on "|" and a filter on ":", leaving "\|" and "\:" (and "\\") as the plain character. */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && '|:\\'.includes(s[i + 1])) {
      // keep the escape for the inner split (":" inside a "|" part), drop it at the last level
      cur += sep === '|' && s[i + 1] !== '|' ? c + s[i + 1] : s[i + 1];
      i++;
      continue;
    }
    if (c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
const splitPipes = (raw: string) => splitEscaped(raw, '|');

const chars = (s: string) => [...s];
const int = (s: string | undefined, d: number) => (s !== undefined && /^-?\d+$/.test(s.trim()) ? parseInt(s, 10) : d);

/** Reads 2026-10-25, 2026.10.25, 2026/10/25 (with an optional HH:mm[:ss]) and US 10/25/2026. */
function parseDate(s: string): Date | null {
  const v = s.trim();
  let x = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (x) return new Date(+x[1], +x[2] - 1, +x[3], +(x[4] ?? 0), +(x[5] ?? 0), +(x[6] ?? 0));
  x = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (x) return new Date(x[3].length === 2 ? 2000 + +x[3] : +x[3], +x[1] - 1, +x[2]);
  return null;
}

/** Value filters for {{열|filter:arg}}; `example` is what the inspector inserts. */
export const FILTERS: { example: string; label: Msg }[] = [
  { example: 'upper', label: m('대문자로') },
  { example: 'lower', label: m('소문자로') },
  { example: 'title', label: m('단어 첫 글자만 대문자') },
  { example: 'trim', label: m('앞뒤 공백 없애고 연속 공백은 하나로') },
  { example: 'left:1', label: m('앞에서 N글자 (left:1 → 성)') },
  { example: 'drop:1', label: m('앞 N글자 빼기 (drop:1 → 이름)') },
  { example: 'right:4', label: m('뒤에서 N글자 (right:4)') },
  { example: 'word:1', label: m('N번째 단어 (word:1, 끝에서는 word:-1)') },
  { example: 'default:-', label: m('비어 있으면 대신 쓸 값 (default:-)') },
  { example: 'prefix:(', label: m('값이 있을 때만 앞에 붙이기 (prefix:()') },
  { example: 'suffix:)', label: m('값이 있을 때만 뒤에 붙이기 (suffix:))') },
  { example: 'replace:-:', label: m('바꾸기 (replace:찾을 말:바꿀 말)') },
  { example: 'map:A=B,C=D', label: m('값 바꾸기 표 (map:연사=Speaker,좌장=Chair)') },
  { example: 'pad:4', label: m('앞을 0으로 채워 N자리 (pad:4 → 0007)') },
  { example: 'number', label: m('천 단위 쉼표 (number, 소수 2자리는 number:2)') },
  { example: 'date:YYYY.MM.DD', label: m('날짜 형식 바꾸기 (date:YYYY.MM.DD)') },
];

/** One filter ("left:3") applied to a value. Unknown filters leave the value as it is. */
export function applyFilter(v: string, f: string): string {
  const [rawName, ...args] = splitEscaped(f, ':');
  const rest = args.join(':');
  switch (rawName.trim().toLowerCase()) {
    case 'upper': return v.toUpperCase();
    case 'lower': return v.toLowerCase();
    case 'title': return v.toLowerCase().replace(/(^|[\s\-'’(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
    case 'trim': return v.trim().replace(/\s+/g, ' ');
    case 'left': return chars(v).slice(0, Math.max(0, int(args[0], 1))).join('');
    case 'drop': return chars(v).slice(Math.max(0, int(args[0], 1))).join('');
    case 'right': { const n = Math.max(0, int(args[0], 1)); return n ? chars(v).slice(-n).join('') : ''; }
    case 'word': {
      const words = v.trim().split(/\s+/).filter(Boolean);
      const n = int(args[0], 1);
      return (n < 0 ? words[words.length + n] : words[n - 1]) ?? '';
    }
    case 'default': return v.trim() === '' ? rest : v;
    case 'prefix': return v.trim() === '' ? v : rest + v;
    case 'suffix': return v.trim() === '' ? v : v + rest;
    case 'replace': return args[0] ? v.split(args[0]).join(args.slice(1).join(':')) : v;
    case 'map':
      for (const pair of rest.split(',')) {
        const k = pair.indexOf('=');
        if (k > 0 && pair.slice(0, k).trim() === v.trim()) return pair.slice(k + 1).trim();
      }
      return v;
    case 'pad': return v === '' ? v : v.padStart(int(args[0], 2), args[1] || '0');
    case 'number': {
      const x = Number(v.replace(/[,\s]/g, ''));
      if (v.trim() === '' || !Number.isFinite(x)) return v;
      const d = Math.max(0, Math.min(10, int(args[0], 0)));
      return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    case 'date': { const d = parseDate(v); return d ? formatDate(d, rest || 'YYYY-MM-DD') : v; }
    default: return v;
  }
}

/** The column a {{…}} token reads, or '' for #seq, @date, ^GS and the like. */
function tokenColumn(raw: string): string {
  const head = splitPipes(raw)[0].trim();
  return /^[#@^]/.test(head) ? '' : head;
}

/** Column names referenced by a template. */
export function templateColumns(tpl: string): string[] {
  const out: string[] = [];
  for (const x of (tpl || '').matchAll(/\{\{([^{}]*)\}\}/g)) {
    const c = tokenColumn(x[1]);
    if (c) out.push(c);
  }
  return out;
}

/** The template reading column `to` wherever it read `from`, filters kept. */
export function renameInTemplate(tpl: string, from: string, to: string): string {
  if (!tpl || tpl.indexOf('{{') < 0) return tpl;
  return tpl.replace(/\{\{([^{}]*)\}\}/g, (all, raw: string) => {
    if (tokenColumn(raw) !== from) return all;
    const i = raw.search(/(?<!\\)\|/);
    return `{{${to}${i < 0 ? '' : raw.slice(i)}}}`;
  });
}

/** Designs (contents, table cells, rules and design rules) reading column `to` wherever they read `from`. The data is left alone. */
export function renameColumnInDesigns(p: Project, from: string, to: string): Project {
  const col = (c: string) => (c === from ? to : c);
  const fix = (o: LabelObject): LabelObject => {
    let x = { ...o, rules: o.rules.map((r) => ({ ...r, column: col(r.column), set: r.set.text ? { ...r.set, text: renameInTemplate(r.set.text, from, to) } : r.set })) } as LabelObject;
    if ('content' in x) x = { ...x, content: renameInTemplate(x.content, from, to) } as LabelObject;
    if (x.type === 'table') x = { ...x, cells: x.cells.map((row) => row.map((v) => renameInTemplate(v, from, to))) };
    return x;
  };
  return {
    ...p,
    designs: p.designs.map((d) => ({ ...d, objects: d.objects.map(fix), back: d.back?.map(fix) })),
    designRules: p.designRules.map((r) => ({ ...r, column: col(r.column) })),
  };
}

export function usedColumns(p: Project): string[] {
  const set = new Set<string>();
  for (const d of p.designs) {
    for (const o of [...d.objects, ...(d.back ?? [])]) {
      if ('content' in o) templateColumns(o.content).forEach((c) => set.add(c));
      if (o.type === 'table') o.cells.flat().forEach((v) => templateColumns(v).forEach((c) => set.add(c)));
      o.rules.forEach((r) => r.column && set.add(r.column));
    }
  }
  p.designRules.forEach((r) => r.column && set.add(r.column));
  return [...set];
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

export function testRule(op: RuleOp, subject: string, value: string): boolean {
  const s = subject ?? '';
  switch (op) {
    case 'eq': return s.trim() === value.trim();
    case 'neq': return s.trim() !== value.trim();
    case 'contains': return value !== '' && s.includes(value);
    case 'empty': return s.trim() === '';
    case 'notEmpty': return s.trim() !== '';
    case 'hangul': return HANGUL.test(s);
    case 'latin': return s.trim() !== '' && !HANGUL.test(s);
    case 'longer': return s.length > (parseInt(value, 10) || 0);
  }
}

export const RULE_OPS: { op: RuleOp; label: Msg; needsValue: boolean }[] = [
  { op: 'eq', label: m('= 같음'), needsValue: true },
  { op: 'neq', label: m('≠ 다름'), needsValue: true },
  { op: 'contains', label: m('포함'), needsValue: true },
  { op: 'empty', label: m('비어 있음'), needsValue: false },
  { op: 'notEmpty', label: m('값 있음'), needsValue: false },
  { op: 'hangul', label: m('한글 포함'), needsValue: false },
  { op: 'latin', label: m('영문(한글 없음)'), needsValue: false },
  { op: 'longer', label: m('글자 수 >'), needsValue: true },
];

export function pickDesign(p: Project, row?: Row): Design {
  if (row) {
    for (const r of p.designRules) {
      if (testRule(r.op, row.values[r.column] ?? '', r.value)) {
        const d = p.designs.find((x) => x.id === r.designId);
        if (d) return d;
      }
    }
  }
  return p.designs[0];
}

export interface Resolved<T extends LabelObject = LabelObject> {
  obj: T;
  content: string;
  hidden: boolean;
}

/** Apply content templates and conditional style rules for one data row. */
export function resolveObject(o: LabelObject, ctx: ResolveCtx): Resolved {
  // a text's content may carry rich-text tags; values filled in never do (see render/rich.ts)
  const fill = (tpl: string) => resolveTemplate(tpl, ctx, o.type === 'text' ? protectValue : undefined);
  const plain = (s: string) => (o.type === 'text' ? plainText(s) : s);
  let content = 'content' in o ? fill(o.content) : '';
  let obj: LabelObject = o;
  let hidden = o.hidden;
  for (const r of o.rules) {
    const subject = r.column ? ctx.row?.values[r.column] ?? '' : plain(content);
    if (!testRule(r.op, subject, r.value)) continue;
    const s = r.set;
    if (s.hidden) hidden = true;
    if (s.text !== undefined && s.text !== '') content = fill(s.text);
    if (s.color) {
      if (obj.type === 'text') obj = { ...obj, fill: { type: 'solid', color: s.color } };
      else if (obj.type === 'barcode' || obj.type === 'qr' || obj.type === 'table') obj = { ...obj, color: s.color };
      else if ('fill' in obj) obj = { ...obj, fill: { type: 'solid', color: s.color } };
    }
    if (s.stroke && 'stroke' in obj) obj = { ...obj, stroke: s.stroke };
    if (s.fontSize && obj.type === 'text') obj = { ...obj, fontSize: s.fontSize };
  }
  // an image without a template shows its own file, so it never counts as empty
  if (o.hideIfEmpty && 'content' in o && plain(content).trim() === '' && (o.type !== 'image' || o.content.trim())) hidden = true;
  return { obj, content, hidden };
}
