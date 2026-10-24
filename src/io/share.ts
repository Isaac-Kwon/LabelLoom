import { t } from '../i18n';
import type { Project } from '../model/types';
import { newRow } from '../model/defaults';
import { projectToZip } from './archive';
import { download, safeName } from './export';
import { EXT, parseProject, ZIP_EXT } from './project';

/** Settings sharing through the URL fragment: JSON → deflate-raw → base64url. Nothing reaches a server. */

const toB64Url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export interface ShareOptions { includeData: boolean; includeImages: boolean; includeFonts: boolean }

function stripImages(p: Project): Project {
  const strip = <T extends { type: string }>(o: T): T =>
    o.type === 'image' ? { ...o, src: '' } : o.type === 'qr' ? { ...o, logo: undefined } : o;
  return {
    ...p,
    paper: { ...p.paper, background: undefined },
    images: undefined,
    designs: p.designs.map((d) => ({ ...d, objects: d.objects.map(strip), back: d.back?.map(strip) })),
  };
}

/** Without the name list the receiver would see empty labels, so leave one row that shows each column's name. */
function sampleRow(p: Project): Project {
  const { columns } = p.data;
  if (!columns.length) return { ...p, data: { columns, rows: [] } };
  return { ...p, data: { columns, rows: [newRow(Object.fromEntries(columns.map((c) => [c, c])))] } };
}

function stripSvg(p: Project): Project {
  const strip = <T extends { type: string }>(o: T): T => (o.type === 'svg' ? { ...o, svg: '' } : o);
  return { ...p, designs: p.designs.map((d) => ({ ...d, objects: d.objects.map(strip), back: d.back?.map(strip) })) };
}

function shareProject(p: Project, o: ShareOptions): Project {
  let proj = o.includeImages ? p : stripImages(p);
  // pictures per data row only matter with the rows they belong to
  if (!o.includeData) proj = { ...sampleRow(proj), images: undefined };
  return o.includeFonts ? proj : { ...proj, fonts: [] };
}

const shareJson = (p: Project, o: ShareOptions) => JSON.stringify(shareProject(p, o));

const compress = async (json: string) => toB64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));

export const encodeShare = (p: Project, o: ShareOptions) => compress(shareJson(p, o));

/** The same project the link carries, as a file to send when the link is too long. */
export function downloadShareFile(p: Project, o: ShareOptions) {
  download(new Blob([shareJson(p, o)], { type: 'application/json' }), safeName(p.name) + EXT);
}

/** Same, as a ZIP with the pictures and fonts as their original files. */
export async function downloadShareZip(p: Project, o: ShareOptions) {
  download(await projectToZip(shareProject(p, o)), safeName(p.name) + ZIP_EXT);
}

/** Above this, messengers and some browsers may cut the link off. */
export const LINK_LIMIT = 32 * 1024;

/** A removable part of the link: what it costs, measured by encoding the link again without it. */
export type SharePart = 'images' | 'svg' | 'data' | 'fonts' | 'design';
export interface SharePartSize { part: SharePart; bytes: number; count: number }

/**
 * Splits the length of `code` into the parts it carries, largest first. Each part is measured as
 * the difference against the link without it, so the numbers say what leaving it out would save;
 * 'design' is the link with all of them left out (objects, paper, settings).
 */
export async function measureShare(p: Project, o: ShareOptions, code: string): Promise<SharePartSize[]> {
  const objs = p.designs.flatMap((d) => [...d.objects, ...(d.back ?? [])]);
  const images = objs.filter((x) => (x.type === 'image' && x.src) || (x.type === 'qr' && x.logo)).length + (p.paper.background?.src ? 1 : 0) +
    (o.includeData ? Object.keys(p.images ?? {}).length : 0);
  const svgs = objs.filter((x) => x.type === 'svg' && x.svg).length;
  const without: [SharePart, number, Project, ShareOptions][] = [];
  if (o.includeImages && images) without.push(['images', images, p, { ...o, includeImages: false }]);
  if (svgs) without.push(['svg', svgs, stripSvg(p), o]);
  if (o.includeData && p.data.rows.length) without.push(['data', p.data.rows.length, p, { ...o, includeData: false }]);
  if (o.includeFonts && p.fonts.length) without.push(['fonts', p.fonts.length, p, { ...o, includeFonts: false }]);
  const parts: SharePartSize[] = await Promise.all(without.map(async ([part, count, q, qo]) =>
    ({ part, count, bytes: Math.max(0, code.length - (await compress(shareJson(q, qo))).length) })));
  // deflate shares matches across parts, so the parts do not add up exactly: measure the rest on its own
  const bare = await compress(shareJson(stripSvg(p), { includeData: false, includeImages: false, includeFonts: false }));
  parts.push({ part: 'design', count: objs.length, bytes: bare.length });
  return parts.sort((a, b) => b.bytes - a.bytes);
}

export const kbOf = (bytes: number) => (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0);

export function partLabel(x: SharePartSize, p: Project): string {
  switch (x.part) {
    case 'images': return t('그림 {n}개', { n: x.count });
    case 'svg': return t('SVG 그래픽 {n}개', { n: x.count });
    case 'data': return t('명단 {rows}행 × {cols}열', { rows: x.count, cols: p.data.columns.length });
    case 'fonts': return t('내장 글꼴 {n}개', { n: x.count });
    case 'design': return t('디자인 자체 (개체 {n}개)', { n: x.count });
  }
}

/** "그림 3개 (41 KB, 78%)" for the part that makes the link long; `total` is the length of the link. */
export function mainCause(parts: SharePartSize[], p: Project, total: number): string {
  const x = parts[0];
  return t('{what} ({kb} KB, {pct}%)', { what: partLabel(x, p), kb: kbOf(x.bytes), pct: Math.round((x.bytes / total) * 100) });
}

export async function decodeShare(code: string): Promise<Project> {
  const bytes = await pipe(fromB64Url(code), new DecompressionStream('deflate-raw'));
  return parseProject(new TextDecoder().decode(bytes));
}

/** p = open in the editor, q = open in quick print (fill in fields and print). */
export type ShareKind = 'p' | 'q';

export function shareUrl(code: string, kind: ShareKind = 'p') {
  return `${location.origin === 'null' ? 'file://' : location.origin}${location.pathname}${kind === 'q' ? '?quick' : ''}#${kind}=${code}`;
}

/** Quick print links carry the design and a sample row, never the name list (fonts would make them too long). */
const QUICK: ShareOptions = { includeData: false, includeImages: true, includeFonts: false };
export const quickShareCode = (p: Project) => encodeShare(p, QUICK);

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* file:// or no permission */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/** Copy a direct link to the quick print page with this template; returns a message for the user. */
export async function copyQuickLink(p: Project): Promise<string> {
  const code = await quickShareCode(p);
  const url = shareUrl(code, 'q');
  const size = new Blob([url]).size;
  if (!(await copyText(url))) return t('복사하지 못했습니다. 주소창의 주소를 직접 복사하세요.');
  if (size <= LINK_LIMIT) return t('빠른 출력 링크를 복사했습니다.');
  const cause = mainCause(await measureShare(p, QUICK, code), p, size);
  return t('링크를 복사했습니다 ({kb} KB). 길어서 메신저에서 잘릴 수 있으니 템플릿 파일로 공유하세요. 주요 원인: {cause}', { kb: kbOf(size), cause });
}

export function readShareHash(): { kind: ShareKind; code: string } | null {
  const m = location.hash.match(/^#([pq])=([A-Za-z0-9_-]+)/);
  return m ? { kind: m[1] as ShareKind, code: m[2] } : null;
}
