import JSZip from 'jszip';
import { t } from '../i18n';
import { isZipFile } from '../io/archive';
import { pickFile, pickFiles, readAsDataURL } from '../io/project';
import type { LabelObject } from '../model/types';
import { fetchPicture, fetchPictures, findPicture, isUrl } from '../render/images';
import { act, currentObjects, useStore } from '../store';

/** Ask for an image/SVG file and load it into an existing object, keeping the box width. */
export async function pickImageInto(id: string, type: 'image' | 'svg') {
  const file = await pickFile(type === 'svg' ? '.svg,image/svg+xml' : 'image/*');
  if (!file) return;
  await loadMediaInto(id, file);
}

export async function loadMediaInto(id: string, file: File) {
  const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
  const o = currentObjects(useStore.getState()).find((x) => x.id === id);
  if (!o) return;
  if (isSvg && o.type === 'svg') {
    const svg = await file.text();
    const ratio = svgRatio(svg);
    act.update([id], { svg, h: ratio ? round(o.w / ratio) : o.h, name: file.name } as Partial<LabelObject>);
    return;
  }
  const src = await readAsDataURL(await downscale(file));
  const ratio = await imageRatio(src);
  act.update([id], { type: 'image', src, h: ratio ? round(o.w / ratio) : o.h, name: file.name } as Partial<LabelObject>);
}

const round = (v: number) => Math.round(v * 100) / 100;

function svgRatio(svg: string): number | null {
  const vb = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (vb) { const [, , w, h] = vb[1].split(/[\s,]+/).map(Number); if (w && h) return w / h; }
  const w = parseFloat(svg.match(/\swidth\s*=\s*["']([\d.]+)/)?.[1] ?? ''), h = parseFloat(svg.match(/\sheight\s*=\s*["']([\d.]+)/)?.[1] ?? '');
  return w && h ? w / h : null;
}

export function imageRatio(src: string): Promise<number | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth / img.naturalHeight || null);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** Keep embedded photos reasonable: large images are resized to `max` px (2400) on the long edge. */
async function downscale(file: Blob, max = 2400, minBytes = 1.5e6): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < minBytes) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (k >= 1) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((r) => c.toBlob((b) => r(b ?? file), file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- pictures per data row (Project.images) ---------- */

const PICTURE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };

/** Pictures from files or ZIPs, keyed by file name. Photos are kept to 1600 px, plenty for a badge. */
export async function readPictures(files: File[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const add = async (name: string, blob: Blob) => { out[name] = await readAsDataURL(await downscale(blob, 1600, 4e5)); };
  for (const f of files) {
    if (isZipFile(f)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const entry of Object.values(zip.files)) {
        const name = entry.name.replace(/^.*\//, '');
        const type = PICTURE_EXT[name.split('.').pop()?.toLowerCase() ?? ''];
        if (entry.dir || !type || name.startsWith('._')) continue;
        await add(name, new Blob([await entry.async('arraybuffer')], { type }));
      }
    } else if (/^image\//.test(f.type)) await add(f.name, f);
  }
  return out;
}

/** Ask for picture files (or ZIPs of them) and add them to the project; returns how many. */
export async function addPictures(): Promise<number> {
  const files = await pickFiles('image/*,.zip,application/zip');
  if (!files.length) return 0;
  const pics = await readPictures(files);
  const n = Object.keys(pics).length;
  if (n) useStore.getState().commit((p) => ({ ...p, images: { ...p.images, ...pics } }));
  return n;
}

/** Picture from a web address into an image object: embedded when the server allows it, else linked (after asking). */
export async function pictureFromUrl(id: string) {
  const s = useStore.getState();
  const url = prompt(t('그림 주소 (https://…)'))?.trim();
  if (!url) return;
  if (!isUrl(url)) { s.notify(t('http:// 또는 https://로 시작하는 주소를 넣으세요.')); return; }
  const data = await fetchPicture(url);
  if (!data && !confirm(t('이 서버는 그림을 내려받도록 허용하지 않아 프로젝트에 저장할 수 없습니다.\n주소로만 연결할까요? 화면과 인쇄에는 보이지만 PDF·PNG에서는 빠지고, 원본이 없어지면 그림도 사라집니다.'))) return;
  const o = currentObjects(s).find((x) => x.id === id);
  const ratio = await imageRatio(data ?? url);
  act.update([id], { type: 'image', src: data ?? url, ...(o && ratio ? { h: round(o.w / ratio) } : {}) } as Partial<LabelObject>);
  s.notify(data ? t('그림을 내려받아 프로젝트에 넣었습니다.') : t('그림을 주소로 연결했습니다.'));
}

/** Save the web pictures the rows point to into the project, so they keep working offline and if the source goes away. */
export async function saveRowPictures(urls: string[], onProgress?: (done: number, total: number) => void) {
  const failed = await fetchPictures(urls, onProgress);
  const got: Record<string, string> = {};
  for (const u of urls) {
    if (failed.includes(u)) continue;
    const d = findPicture(undefined, u);
    if ('src' in d && d.src.startsWith('data:')) got[u] = d.src;
  }
  if (Object.keys(got).length) useStore.getState().commit((p) => ({ ...p, images: { ...p.images, ...got } }));
  return { saved: Object.keys(got).length, failed };
}
