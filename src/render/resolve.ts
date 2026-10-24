import { m, type Msg } from '../i18n';
import type { Design, LabelObject, Project, Row, RuleOp } from '../model/types';

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
 */
export function resolveTemplate(tpl: string, ctx: ResolveCtx): string {
  if (!tpl || tpl.indexOf('{{') < 0) return tpl ?? '';
  return tpl.replace(/\{\{([^{}]*)\}\}/g, (_, raw: string) => {
    const tok = raw.trim();
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
  });
}

/** Column names referenced by a template. */
export function templateColumns(tpl: string): string[] {
  const out: string[] = [];
  for (const m of (tpl || '').matchAll(/\{\{([^{}#@^][^{}]*)\}\}/g)) out.push(m[1].trim());
  return out;
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
  let content = 'content' in o ? resolveTemplate(o.content, ctx) : '';
  let obj: LabelObject = o;
  let hidden = o.hidden;
  for (const r of o.rules) {
    const subject = r.column ? ctx.row?.values[r.column] ?? '' : content;
    if (!testRule(r.op, subject, r.value)) continue;
    const s = r.set;
    if (s.hidden) hidden = true;
    if (s.text !== undefined && s.text !== '') content = resolveTemplate(s.text, ctx);
    if (s.color) {
      if (obj.type === 'text') obj = { ...obj, fill: { type: 'solid', color: s.color } };
      else if (obj.type === 'barcode' || obj.type === 'qr' || obj.type === 'table') obj = { ...obj, color: s.color };
      else if ('fill' in obj) obj = { ...obj, fill: { type: 'solid', color: s.color } };
    }
    if (s.stroke && 'stroke' in obj) obj = { ...obj, stroke: s.stroke };
    if (s.fontSize && obj.type === 'text') obj = { ...obj, fontSize: s.fontSize };
  }
  // an image without a template shows its own file, so it never counts as empty
  if (o.hideIfEmpty && 'content' in o && content.trim() === '' && (o.type !== 'image' || o.content.trim())) hidden = true;
  return { obj, content, hidden };
}
