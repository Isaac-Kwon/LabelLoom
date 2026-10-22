import type { Project } from '../model/types';
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

export async function encodeShare(p: Project, o: ShareOptions): Promise<string> {
  const proj = o.includeImages ? p : stripImages(p);
  const json = JSON.stringify(JSON.parse(serialize(proj, { includeData: o.includeData, includeFonts: o.includeFonts })));
  const z = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return toB64Url(z);
}

export async function decodeShare(code: string): Promise<Project> {
  const bytes = await pipe(fromB64Url(code), new DecompressionStream('deflate-raw'));
  return parseProject(new TextDecoder().decode(bytes));
}

export function shareUrl(code: string) {
  return `${location.origin === 'null' ? 'file://' : location.origin}${location.pathname}#p=${code}`;
}

export function readShareHash(): string | null {
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
