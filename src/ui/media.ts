import { pickFile, readAsDataURL } from '../io/project';
import type { LabelObject } from '../model/types';
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

/** Keep embedded photos reasonable: large images are resized to 2400px on the long edge. */
async function downscale(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 1.5e6) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
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
