import { t } from '../i18n';
import { newObject, uid } from '../model/defaults';
import type { BarcodeObj, LabelObject, ObjType, QrObj, TextObj } from '../model/types';
import { act, currentObjects, useStore } from '../store';

/** Objects whose content is typed text; an image's content names a picture and is set in the inspector. */
export const inlineEditable = (o: LabelObject): o is TextObj | BarcodeObj | QrObj => o.type === 'text' || o.type === 'barcode' || o.type === 'qr';

const st = () => useStore.getState();
const sel = () => {
  const s = st();
  const ids = new Set(s.selection);
  return currentObjects(s).filter((o) => ids.has(o.id));
};

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function align(kind: AlignKind) {
  const objs = sel().filter((o) => !o.locked);
  if (!objs.length) return;
  const p = st().project.paper;
  // one object (or a single group) aligns to the label, several align to their common bounds
  const groups = new Set(objs.map((o) => o.groupId ?? o.id));
  const toLabel = groups.size === 1;
  const b = toLabel ? { x0: 0, y0: 0, x1: p.labelWidth, y1: p.labelHeight } : bounds(objs);
  const ob = bounds(objs);
  act.update(objs.map((o) => o.id), (o) => {
    const own = toLabel ? ob : { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h };
    const dx = kind === 'left' ? b.x0 - own.x0 : kind === 'right' ? b.x1 - own.x1 : kind === 'hcenter' ? (b.x0 + b.x1) / 2 - (own.x0 + own.x1) / 2 : 0;
    const dy = kind === 'top' ? b.y0 - own.y0 : kind === 'bottom' ? b.y1 - own.y1 : kind === 'vcenter' ? (b.y0 + b.y1) / 2 - (own.y0 + own.y1) / 2 : 0;
    return { x: o.x + dx, y: o.y + dy };
  });
}

export function bounds(objs: LabelObject[]) {
  return {
    x0: Math.min(...objs.map((o) => o.x)), y0: Math.min(...objs.map((o) => o.y)),
    x1: Math.max(...objs.map((o) => o.x + o.w)), y1: Math.max(...objs.map((o) => o.y + o.h)),
  };
}

export function distribute(axis: 'h' | 'v') {
  const objs = sel().filter((o) => !o.locked);
  if (objs.length < 3) { st().notify(t('3개 이상 선택하세요.')); return; }
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  const sorted = [...objs].sort((a, b) => a[key] - b[key]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const total = sorted.reduce((s, o) => s + o[size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (sorted.length - 1);
  let pos = first[key];
  const map = new Map<string, number>();
  for (const o of sorted) { map.set(o.id, pos); pos += o[size] + gap; }
  act.update(objs.map((o) => o.id), (o) => ({ [key]: map.get(o.id) }));
}

export function matchSize(dim: 'w' | 'h' | 'both') {
  const objs = sel();
  if (objs.length < 2) return;
  const ref = objs[0];
  act.update(objs.slice(1).map((o) => o.id), () => (dim === 'both' ? { w: ref.w, h: ref.h } : { [dim]: ref[dim] }));
}

export function reorder(kind: 'front' | 'back' | 'forward' | 'backward') {
  const ids = new Set(st().selection);
  if (!ids.size) return;
  act.editObjects((objs) => {
    const picked = objs.filter((o) => ids.has(o.id));
    const rest = objs.filter((o) => !ids.has(o.id));
    if (kind === 'front') return [...rest, ...picked];
    if (kind === 'back') return [...picked, ...rest];
    const arr = [...objs];
    if (kind === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    } else {
      for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
    return arr;
  });
}

export function moveToIndex(id: string, index: number) {
  act.editObjects((objs) => {
    const o = objs.find((x) => x.id === id);
    if (!o) return objs;
    const rest = objs.filter((x) => x.id !== id);
    rest.splice(Math.max(0, Math.min(rest.length, index)), 0, o);
    return rest;
  });
}

export function group() {
  const ids = st().selection;
  if (ids.length < 2) return;
  const g = uid();
  act.update(ids, { groupId: g });
}

export function ungroup() {
  act.update(st().selection, { groupId: undefined });
}

export function copy(cut = false) {
  const objs = sel();
  if (!objs.length) return;
  st().setClipboard(structuredClone(objs));
  try { localStorage.setItem('labelloom.clipboard', JSON.stringify(objs)); } catch { /* ignore */ }
  if (cut) act.removeSelected();
}

/** Paste the clipboard, offset a little — or with its top-left corner at `at` (mm). */
export function paste(at?: { x: number; y: number }) {
  let objs = st().clipboard;
  if (!objs.length) {
    try { objs = JSON.parse(localStorage.getItem('labelloom.clipboard') || '[]'); } catch { objs = []; }
  }
  if (!objs.length) return;
  if (!at) { act.insert(objs, 2); return; }
  const b = bounds(objs);
  act.insert(objs.map((o) => ({ ...o, x: o.x - b.x0 + at.x, y: o.y - b.y0 + at.y })));
}

export function duplicate() {
  const objs = sel();
  if (objs.length) act.insert(objs, 2);
}

export function nudge(dx: number, dy: number) {
  const objs = sel().filter((o) => !o.locked);
  if (objs.length) act.update(objs.map((o) => o.id), (o) => ({ x: o.x + dx, y: o.y + dy }));
}

/** Change an object's type, keeping its box and content where possible. */
export function convert(o: LabelObject, type: ObjType): LabelObject {
  const fresh = newObject(type, o.x, o.y, o.w, o.h);
  const keep = { id: o.id, name: o.name, rotation: o.rotation, opacity: o.opacity, locked: o.locked, hidden: o.hidden, groupId: o.groupId, rules: o.rules, hideIfEmpty: o.hideIfEmpty };
  // an image's content names a picture, so text and code content only carries over among themselves
  const content = 'content' in o && o.type !== 'image' ? { content: o.content } : {};
  return { ...fresh, ...keep, ...('content' in fresh && fresh.type !== 'image' ? content : {}) } as LabelObject;
}

/**
 * Grow the selected objects past the trim line by the bleed on every side they touch
 * (within 1 mm of the label edge). An object touching no edge fills the whole label + bleed.
 * With no bleed this snaps those sides to the label edge.
 */
export function extendToBleed() {
  const s = st();
  const { labelWidth: W, labelHeight: H } = s.project.paper;
  const bleed = Math.max(0, s.project.paper.bleed);
  const objs = sel().filter((o) => !o.locked && !o.rotation);
  if (!objs.length) { s.notify(t('회전하지 않은 개체를 선택하세요.')); return; }
  const near = 1;
  act.update(objs.map((o) => o.id), (o) => {
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    const l = x0 <= near, t = y0 <= near, r = x1 >= W - near, b = y1 >= H - near;
    const all = !l && !t && !r && !b;
    if (l || all) x0 = -bleed;
    if (t || all) y0 = -bleed;
    if (r || all) x1 = W + bleed;
    if (b || all) y1 = H + bleed;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

/** Give the selected objects the label's width (from its left edge) or height (from its top edge). */
export function matchLabel(dim: 'w' | 'h') {
  const s = st();
  const objs = sel().filter((o) => !o.locked);
  if (!objs.length) return;
  const { labelWidth: W, labelHeight: H } = s.project.paper;
  act.update(objs.map((o) => o.id), () => (dim === 'w' ? { x: 0, w: W } : { y: 0, h: H }));
}

export function selectAll() {
  const s = st();
  s.select(currentObjects(s).filter((o) => !o.locked && !o.hidden).map((o) => o.id));
}
