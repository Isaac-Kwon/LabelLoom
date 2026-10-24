import type { ImageObj, LabelObject, Project } from '../model/types';
import type { JobItem } from './jobs';
import { resolveObject, type ResolveCtx } from './resolve';

/**
 * Pictures chosen per data row. An image object's resolved content names the picture:
 *   kim.jpg / kim       a file in Project.images (case and extension don't matter)
 *   https://…           a picture on the web; fetched into a cache for PNG/PDF output
 *   data:image/…        the picture itself
 * Pictures from the web need the server to allow cross-origin reads (CORS) to go into PNG and
 * PDF files; the editor and browser print show them either way.
 */

export const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

const base = (s: string) => s.trim().replace(/^.*[\\/]/, '').toLowerCase();
const stem = (s: string) => base(s).replace(/\.[a-z0-9]{2,5}$/, '');

const indexes = new WeakMap<Record<string, string>, Map<string, string>>();
function index(images: Record<string, string>) {
  let m = indexes.get(images);
  if (!m) {
    m = new Map();
    for (const [k, v] of Object.entries(images)) {
      if (!m.has(base(k))) m.set(base(k), v);
      if (!m.has(stem(k))) m.set(stem(k), v);
    }
    indexes.set(images, m);
  }
  return m;
}

/** url → data url, or null when it could not be fetched */
const remote = new Map<string, string | null>();

export type Picture =
  | { src: string; failed?: boolean }
  | { missing: string };

/** The picture a value names; '' for no picture. */
export function findPicture(images: Record<string, string> | undefined, value: string): Picture {
  const v = value.trim();
  if (!v) return { src: '' };
  if (/^data:image\//i.test(v)) return { src: v };
  if (images) {
    const hit = images[v] ?? index(images).get(base(v)) ?? index(images).get(stem(v));
    if (hit) return { src: hit };
  }
  if (isUrl(v)) {
    const c = remote.get(v);
    return c ? { src: c } : { src: v, failed: c === null };
  }
  return { missing: v };
}

/** The picture an image object shows for a resolved content. */
export const objectPicture = (o: ImageObj, content: string, images?: Record<string, string>): Picture =>
  o.content.trim() ? findPicture(images, content) : isUrl(o.src) ? findPicture(undefined, o.src) : { src: o.src };

/** Picture from the web as a data URL (cached), or null when the server does not allow it. */
export async function fetchPicture(url: string): Promise<string | null> {
  if (remote.has(url) && remote.get(url)) return remote.get(url)!;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    if (!/^image\//.test(blob.type)) throw new Error(blob.type);
    const data = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    remote.set(url, data);
    return data;
  } catch {
    remote.set(url, null);
    return null;
  }
}

/** Fetch every URL (6 at a time); returns the ones that failed. */
export async function fetchPictures(urls: string[], onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const list = [...new Set(urls)];
  const failed: string[] = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const u = list[next++];
      if (!(await fetchPicture(u))) failed.push(u);
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  return failed;
}

const objectsOf = (it: JobItem) => [...it.design.objects, ...(it.design.back ?? [])];

/** Web pictures the output needs that are neither saved in the project nor cached yet. */
export function pictureUrls(p: Project, items: { row?: JobItem['row']; rowIndex: number; design: JobItem['design'] }[]): string[] {
  const out = new Set<string>();
  const now = new Date();
  const add = (o: LabelObject, ctx: ResolveCtx) => {
    if (o.type !== 'image' || o.hidden) return;
    const r = resolveObject(o, ctx);
    if (r.hidden) return;
    const v = (o.content.trim() ? r.content : o.src).trim();
    if (isUrl(v) && !p.images?.[v] && !remote.get(v)) out.add(v);
  };
  for (const it of items) {
    const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: 1, copy: 1, page: 1, now };
    for (const o of objectsOf(it as JobItem)) add(o, ctx);
  }
  return [...out];
}

/** Keys of Project.images that some row's image object refers to. */
export function usedPictureKeys(p: Project): Set<string> {
  const images = p.images ?? {};
  const byName = new Map<string, string[]>();
  for (const k of Object.keys(images)) for (const n of new Set([k, base(k), stem(k)])) byName.set(n, [...(byName.get(n) ?? []), k]);
  const used = new Set<string>();
  const objs = p.designs.flatMap((d) => [...d.objects, ...(d.back ?? [])]).filter((o): o is ImageObj => o.type === 'image' && !!o.content.trim());
  const now = new Date();
  p.data.rows.forEach((row, rowIndex) => {
    for (const o of objs) {
      const v = resolveObject(o, { row, rowIndex, seq: 1, copy: 1, page: 1, now }).content.trim();
      for (const n of [v, base(v), stem(v)]) byName.get(n)?.forEach((k) => used.add(k));
    }
  });
  return used;
}
