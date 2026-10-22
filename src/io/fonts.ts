import type { EmbeddedFont, Project } from '../model/types';
import { clearTextCache } from '../render/text';

const registered = new Map<string, FontFace>();

export async function registerFonts(p: Project) {
  for (const f of p.fonts) {
    const key = f.family + ':' + f.data.length;
    if (registered.has(key)) continue;
    try {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      const face = new FontFace(f.family, bytes);
      await face.load();
      document.fonts.add(face);
      registered.set(key, face);
    } catch (e) {
      console.warn('font load failed', f.family, e);
    }
  }
  clearTextCache();
}

const bufToB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function detectFormat(buf: ArrayBuffer): EmbeddedFont['format'] {
  const h = new Uint8Array(buf.slice(0, 4));
  const tag = String.fromCharCode(...h);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'opentype';
  return 'truetype';
}

export async function fontFromFile(file: Blob, family: string): Promise<EmbeddedFont> {
  const buf = await file.arrayBuffer();
  return { family, data: bufToB64(buf), format: detectFormat(buf) };
}

interface LocalFont { family: string; fullName: string; style: string; postscriptName: string; blob(): Promise<Blob> }

export const localFontsSupported = () => 'queryLocalFonts' in window;

export async function queryLocalFonts(): Promise<LocalFont[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!q) return [];
  try { return await q(); } catch { return []; }
}

/** Common fonts on Korean Windows/macOS systems, shown when local font access is unavailable. */
export const COMMON_FONTS = [
  'Pretendard', 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', 'Nanum Gothic', '나눔고딕', 'Nanum Myeongjo', 'Apple SD Gothic Neo',
  'Gulim', 'Dotum', 'Batang', 'Gungsuh', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma',
  'Segoe UI', 'Consolas', 'Courier New', 'Impact',
];
