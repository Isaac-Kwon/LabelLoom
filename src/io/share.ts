import type { Project } from '../model/types';
import { newRow } from '../model/defaults';
import { parseProject, serialize } from './project';

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
    designs: p.designs.map((d) => ({ ...d, objects: d.objects.map(strip), back: d.back?.map(strip) })),
  };
}

/** Without the name list the receiver would see empty labels, so leave one row that shows each column's name. */
function sampleRow(p: Project): Project {
  const { columns } = p.data;
  if (!columns.length) return { ...p, data: { columns, rows: [] } };
  return { ...p, data: { columns, rows: [newRow(Object.fromEntries(columns.map((c) => [c, c])))] } };
}

export async function encodeShare(p: Project, o: ShareOptions): Promise<string> {
  let proj = o.includeImages ? p : stripImages(p);
  if (!o.includeData) proj = sampleRow(proj);
  const json = JSON.stringify(JSON.parse(serialize(proj, { includeFonts: o.includeFonts })));
  const z = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return toB64Url(z);
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
export const quickShareCode = (p: Project) => encodeShare(p, { includeData: false, includeImages: true, includeFonts: false });

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
  const url = shareUrl(await quickShareCode(p), 'q');
  const kb = new Blob([url]).size / 1024;
  if (!(await copyText(url))) return '복사하지 못했습니다. 주소창의 주소를 직접 복사하세요.';
  return kb > 32 ? `링크를 복사했습니다 (${kb.toFixed(0)} KB — 길어서 메신저에서 잘릴 수 있습니다. 이미지를 줄이거나 템플릿 파일로 공유하세요)` : '빠른 출력 링크를 복사했습니다.';
}

export function readShareHash(): { kind: ShareKind; code: string } | null {
  const m = location.hash.match(/^#([pq])=([A-Za-z0-9_-]+)/);
  return m ? { kind: m[1] as ShareKind, code: m[2] } : null;
}
