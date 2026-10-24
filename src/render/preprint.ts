import type { Paper } from '../model/types';

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Writable area of a pre-printed label, in label-local mm. */
export function preprintArea(pa: Paper) {
  const p = pa.preprint;
  if (!p) return { x: 0, y: 0, w: pa.labelWidth, h: pa.labelHeight };
  return {
    x: p.borderSide, y: p.borderTop,
    w: Math.max(0, pa.labelWidth - 2 * p.borderSide), h: Math.max(0, pa.labelHeight - p.borderTop - p.borderBottom),
  };
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}` +
    `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`;
}

/** The frame of one label in label-local mm: the label shape with the writable area cut out. */
export function preprintMarkup(pa: Paper): string {
  const p = pa.preprint;
  if (!p) return '';
  const a = preprintArea(pa);
  const hole = a.w > 0 && a.h > 0 ? roundRect(a.x, a.y, a.w, a.h, p.innerRadius) : '';
  return `<path d="${roundRect(0, 0, pa.labelWidth, pa.labelHeight, pa.cornerRadius)}${hole}" fill="${p.color}" fill-rule="evenodd"/>`;
}

/** Frames for every cell of the paper's label grid, in sheet mm (previews only, never printed). */
export function preprintSheetMarkup(pa: Paper): string {
  if (!pa.preprint) return '';
  const one = preprintMarkup(pa);
  const out: string[] = [];
  for (let r = 0; r < pa.rows; r++) for (let c = 0; c < pa.cols; c++) {
    out.push(`<g transform="translate(${n(pa.marginLeft + c * (pa.labelWidth + pa.gapX))} ${n(pa.marginTop + r * (pa.labelHeight + pa.gapY))})">${one}</g>`);
  }
  return `<g opacity="0.85" style="mix-blend-mode:multiply" pointer-events="none">${out.join('')}</g>`;
}
