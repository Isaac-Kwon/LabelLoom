/**
 * Mixed styles inside one text object, written as tags in its content:
 *   <b>…</b> <i>…</i> <u>…</u>     bold, italic, underline (on or, inside a bold text, off with <b=0>)
 *   <color=#dc2626>…</color>       text colour (#rgb, #rrggbb or a CSS colour name)
 *   <size=70%>…</size>             size relative to the object's font size
 * Tags come from the design only: '<' in data values is replaced by PROTECT while the template
 * is filled in (resolveObject), so a name such as "<b>" in the list prints as typed.
 */

export interface RunStyle { bold: boolean; italic: boolean; underline: boolean; color?: string; scale: number }
export interface Run extends RunStyle { text: string }

/** stands for '<' in values filled into a text template */
export const PROTECT = '';
export const protectValue = (v: string) => (v.includes('<') ? v.replace(/</g, PROTECT) : v);

const TAG = /<(\/?)(b|i|u|color|size)(?:=([^<>]*))?>/gi;
const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;

export const hasMarkup = (s: string) => /<\/?(b|i|u|color|size)(=[^<>]*)?>/i.test(s);

/** Content without tags, with '<' put back: what hide-if-empty, rules and previews look at. */
export function plainText(s: string): string {
  if (!s) return s;
  const t = s.includes('<') ? s.replace(TAG, (all, close: string, name: string, val?: string) => (tagValid(name, val, !!close) ? '' : all)) : s;
  return t.includes(PROTECT) ? t.split(PROTECT).join('<') : t;
}

function tagValid(name: string, val: string | undefined, close: boolean): boolean {
  const k = name.toLowerCase();
  if (close) return val === undefined;
  if (k === 'color') return !!val && COLOR.test(val.trim());
  if (k === 'size') return !!val && /^\d+(\.\d+)?%$/.test(val.trim());
  return val === undefined || val === '0' || val === '1';
}

/** Splits content into runs of one style each, starting from `base`. */
export function parseRich(s: string, base: RunStyle): Run[] {
  const unprotect = (x: string) => (x.includes(PROTECT) ? x.split(PROTECT).join('<') : x);
  if (!s.includes('<')) return [{ ...base, text: unprotect(s) }];
  const stack: { name: string; apply: (st: RunStyle) => RunStyle }[] = [];
  const style = () => stack.reduce((st, x) => x.apply(st), { ...base });
  const out: Run[] = [];
  const emit = (text: string) => {
    if (!text) return;
    const st = style();
    const last = out[out.length - 1];
    if (last && same(last, st)) last.text += unprotect(text);
    else out.push({ ...st, text: unprotect(text) });
  };
  let at = 0;
  for (const m of s.matchAll(TAG)) {
    const [all, close, rawName, val] = m;
    const name = rawName.toLowerCase();
    if (!tagValid(name, val, !!close)) continue;
    emit(s.slice(at, m.index));
    at = m.index! + all.length;
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { stack.splice(i, 1); break; }
      continue;
    }
    const on = val !== '0';
    const v = val?.trim() ?? '';
    stack.push({
      name,
      apply: name === 'b' ? (st) => ({ ...st, bold: on }) : name === 'i' ? (st) => ({ ...st, italic: on }) : name === 'u' ? (st) => ({ ...st, underline: on })
        : name === 'color' ? (st) => ({ ...st, color: v })
          : (st) => ({ ...st, scale: st.scale * Math.max(0.1, Math.min(5, parseFloat(v) / 100)) }),
    });
  }
  emit(s.slice(at));
  return out.length ? out : [{ ...base, text: '' }];
}

const same = (a: RunStyle, b: RunStyle) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.color === b.color && a.scale === b.scale;
