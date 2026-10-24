import JSZip from 'jszip';
import { t } from '../i18n';
import type { EmbeddedFont, LabelObject, Project } from '../model/types';

/**
 * Project as a ZIP: project.json plus images/ and fonts/ holding the embedded files as they were
 * added (same bytes, no re-encoding). In project.json those fields read "zip:images/001.png".
 */

const PROJECT = 'project.json';
const REF = 'zip:';

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
};
const IMAGE_MIME = Object.fromEntries(Object.entries(IMAGE_EXT).map(([k, v]) => [v, k]));
const FONT_EXT: Record<EmbeddedFont['format'], string> = { truetype: 'ttf', opentype: 'otf', woff: 'woff', woff2: 'woff2' };

const isZipRef = (s: unknown): s is string => typeof s === 'string' && s.startsWith(REF);

export const isZipFile = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

export async function projectToZip(p: Project): Promise<Blob> {
  const zip = new JSZip();
  const paths = new Map<string, string>(); // embedded data → path, so a picture used twice is stored once
  const counts: Record<string, number> = {};
  const put = (data: string, b64: string, dir: string, ext: string) => {
    let path = paths.get(data);
    if (!path) {
      counts[dir] = (counts[dir] ?? 0) + 1;
      path = `${dir}/${String(counts[dir]).padStart(3, '0')}.${ext}`;
      zip.file(path, b64, { base64: true });
      paths.set(data, path);
    }
    return REF + path;
  };
  // a data URL the table does not know (or not base64) stays inline, so nothing is changed on the way
  const image = (src: string | undefined) => {
    const m = src?.match(/^data:([^;,]+);base64,(.*)$/s);
    return m && IMAGE_EXT[m[1]] ? put(src!, m[2], 'images', IMAGE_EXT[m[1]]) : src;
  };
  const obj = (o: LabelObject): LabelObject =>
    o.type === 'image' ? { ...o, src: image(o.src) ?? '' } : o.type === 'qr' && o.logo ? { ...o, logo: image(o.logo) } : o;
  const out: Project = {
    ...p,
    paper: p.paper.background ? { ...p.paper, background: { ...p.paper.background, src: image(p.paper.background.src) ?? '' } } : p.paper,
    designs: p.designs.map((d) => ({ ...d, objects: d.objects.map(obj), back: d.back?.map(obj) })),
    fonts: p.fonts.map((f) => ({ ...f, data: put('font:' + f.data, f.data, 'fonts', FONT_EXT[f.format] ?? 'bin') })),
  };
  zip.file(PROJECT, JSON.stringify(out, null, 1));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
}

/** The project object stored in the ZIP, with the files put back in place; still to be migrated. */
export async function projectFromZip(file: Blob): Promise<unknown> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new Error(t('ZIP 파일을 열 수 없습니다.')); }
  const entry = zip.file(PROJECT);
  if (!entry) throw new Error(t('ZIP 안에 {name}이(가) 없습니다.', { name: PROJECT }));
  let p: Project;
  try { p = JSON.parse(await entry.async('string')); } catch { throw new Error(t('JSON 형식이 올바르지 않습니다.')); }
  const read = async (ref: string) => {
    const f = zip.file(ref.slice(REF.length));
    if (!f) throw new Error(t('ZIP 안에 {name}이(가) 없습니다.', { name: ref.slice(REF.length) }));
    return f.async('base64');
  };
  const image = async (src: unknown) => {
    if (!isZipRef(src)) return src as string;
    const ext = src.split('.').pop()!.toLowerCase();
    return `data:${IMAGE_MIME[ext] ?? 'application/octet-stream'};base64,${await read(src)}`;
  };
  const obj = async (o: LabelObject): Promise<LabelObject> =>
    o.type === 'image' ? { ...o, src: await image(o.src) } : o.type === 'qr' && o.logo ? { ...o, logo: await image(o.logo) } : o;
  if (!p || typeof p !== 'object') return p;
  if (p.paper?.background) p.paper.background.src = await image(p.paper.background.src);
  if (Array.isArray(p.designs)) {
    for (const d of p.designs) {
      if (Array.isArray(d.objects)) d.objects = await Promise.all(d.objects.map(obj));
      if (Array.isArray(d.back)) d.back = await Promise.all(d.back.map(obj));
    }
  }
  if (Array.isArray(p.fonts)) p.fonts = await Promise.all(p.fonts.map(async (f) => (isZipRef(f.data) ? { ...f, data: await read(f.data) } : f)));
  return p;
}
