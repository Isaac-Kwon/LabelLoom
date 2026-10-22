import bwipjs from 'bwip-js/browser';
import type { BarcodeObj, QrObj } from '../model/types';

export const SYMBOLOGIES: { group: string; items: { id: string; label: string; sample: string }[] }[] = [
  {
    group: '1D',
    items: [
      { id: 'code128', label: 'Code 128', sample: 'ABC-12345' },
      { id: 'gs1-128', label: 'GS1-128', sample: '(01)09521234543213(10)ABC123' },
      { id: 'code39', label: 'Code 39', sample: 'CODE39' },
      { id: 'code39ext', label: 'Code 39 Extended', sample: 'Code39' },
      { id: 'code93', label: 'Code 93', sample: 'CODE93' },
      { id: 'ean13', label: 'EAN-13', sample: '880123456789' },
      { id: 'ean8', label: 'EAN-8', sample: '8801234' },
      { id: 'ean5', label: 'EAN-5 (애드온)', sample: '90200' },
      { id: 'ean2', label: 'EAN-2 (애드온)', sample: '05' },
      { id: 'upca', label: 'UPC-A', sample: '01234567890' },
      { id: 'upce', label: 'UPC-E', sample: '0123456' },
      { id: 'interleaved2of5', label: 'ITF (Interleaved 2 of 5)', sample: '12345678' },
      { id: 'itf14', label: 'ITF-14', sample: '1880123456789' },
      { id: 'rationalizedCodabar', label: 'Codabar', sample: 'A123456B' },
      { id: 'msi', label: 'MSI', sample: '1234567' },
      { id: 'plessey', label: 'Plessey', sample: '01234ABCD' },
      { id: 'isbn', label: 'ISBN', sample: '978-3-16-148410-0' },
    ],
  },
];

export const CODES_2D: { id: QrObj['symbology']; label: string }[] = [
  { id: 'qrcode', label: 'QR 코드' },
  { id: 'gs1qrcode', label: 'GS1 QR' },
  { id: 'datamatrix', label: 'Data Matrix' },
  { id: 'gs1datamatrix', label: 'GS1 Data Matrix' },
  { id: 'azteccode', label: 'Aztec' },
  { id: 'pdf417', label: 'PDF417' },
  { id: 'maxicode', label: 'MaxiCode' },
];

export interface CodeSvg { vw: number; vh: number; inner: string }
export interface CodeErr { error: string }
export type CodeResult = CodeSvg | CodeErr;

const cache = new Map<string, CodeResult>();

function toInner(svg: string, color: string): CodeSvg {
  const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (color && color.toLowerCase() !== '#000000') inner = inner.replace(/#000000/g, color);
  return { vw: vb[2], vh: vb[3], inner };
}

function run(key: string, fn: () => string, color: string): CodeResult {
  const k = key + '|' + color;
  const hit = cache.get(k);
  if (hit) return hit;
  let res: CodeResult;
  try {
    res = toInner(fn(), color);
  } catch (e) {
    res = { error: cleanError(e) };
  }
  if (cache.size > 3000) cache.clear();
  cache.set(k, res);
  return res;
}

function cleanError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^bwipp\.\w+#\d+:\s*/, '').replace(/^bwip-js:\s*/, '');
}

const UNITS_PER_MM = 72 / 25.4;

/** bwip-js validates every key it receives, so drop unset options. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** 1D barcode sized so that its natural aspect ratio matches the box. */
export function barcodeSvg(o: BarcodeObj, text: string): CodeResult {
  if (!text) return { error: '내용 없음' };
  const isGs1 = o.symbology.startsWith('gs1');
  const baseOpts = (height: number, textsize?: number) => clean({
    bcid: o.symbology, text, scale: 1, height,
    includetext: o.showText, textsize, textxalign: 'center' as const,
    parse: !isGs1, backgroundcolor: o.background ? o.background.replace('#', '') : undefined,
  });
  // first pass: natural width in units, to scale text and bar height.
  const probe = run(`p|${o.symbology}|${text}`, () => bwipjs.toSVG(baseOpts(10)), '#000000');
  if ('error' in probe) return probe;
  const k = o.w / probe.vw; // mm per unit
  // desired text height in mm divided by mm-per-unit gives bwip text size in units
  const textsize = o.showText ? Math.max(2, (o.textSize * 25.4 / 72) / k) : undefined;
  const withText = run(`t|${o.symbology}|${text}|${textsize?.toFixed(2)}`, () => bwipjs.toSVG(baseOpts(10, textsize)), '#000000');
  if ('error' in withText) return withText;
  const extra = withText.vh - 10 * UNITS_PER_MM;
  const targetVh = (o.h / o.w) * withText.vw;
  const barMm = Math.max(1, (targetVh - extra) / UNITS_PER_MM);
  const final = run(`f|${o.symbology}|${text}|${textsize?.toFixed(2)}|${barMm.toFixed(2)}|${o.background}`,
    () => bwipjs.toSVG(baseOpts(barMm, textsize)), o.color);
  return final;
}

export function code2dSvg(o: QrObj, text: string): CodeResult {
  if (!text) return { error: '내용 없음' };
  const pad = Math.round(o.quietZone * 2);
  const isGs1 = o.symbology.startsWith('gs1');
  const ec = o.symbology === 'qrcode' || o.symbology === 'gs1qrcode' ? (o.logo ? 'H' : o.errorLevel) : undefined;
  return run(`2d|${o.symbology}|${ec}|${pad}|${o.background}|${text}`, () => bwipjs.toSVG(clean({
    bcid: o.symbology, text, scale: 1, eclevel: ec, parse: !isGs1 && o.symbology !== 'maxicode',
    paddingwidth: pad, paddingheight: pad,
    backgroundcolor: o.background ? o.background.replace('#', '') : undefined,
  }) as never), o.color);
}

/** Smallest module size in mm for warnings. */
export function moduleSizeMm(o: BarcodeObj | QrObj, res: CodeResult): number {
  if ('error' in res) return 0;
  if (o.type === 'qr') return (Math.min(o.w, o.h) / Math.max(res.vw, res.vh)) * 2;
  return o.w / res.vw;
}
