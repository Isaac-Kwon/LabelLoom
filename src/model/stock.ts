import { m, t, type Msg } from '../i18n';
import { labelSize, makePaper, roll } from './presets';
import { SHEETS } from './stockData';
import type { Paper } from './types';

/*
 * Ready-made label stock by maker and product code (docs/label-stock-specs.md).
 * Sheets come from the makers' Word templates and Word's built-in label list (stockData.ts);
 * roll labels are listed here by hand.
 */

export type StockVendor = 'formtec' | 'printec' | 'avery' | 'zweckform' | 'aone' | 'roll';
export type StockConfidence = 'high' | 'medium' | 'low';
/** ISO 3166 region where the stock is sold and used; '*' = sold everywhere */
export type StockCountry = 'KR' | 'US' | 'CA' | 'GB' | 'IE' | 'FR' | 'IT' | 'ES' | 'DE' | 'AT' | 'CH' | 'JP' | '*';

export interface StockItem {
  id: string;
  vendor: StockVendor;
  code: string;
  /** maker's category, in Korean as the maker writes it; only searched */
  category: string;
  confidence: StockConfidence;
  countries: StockCountry[];
  paper: () => Paper;
}

export const EUROPE: StockCountry[] = ['GB', 'IE', 'FR', 'IT', 'ES', 'DE', 'AT', 'CH'];

/*
 * Where each maker's sheets are sold. Avery's A4 L/J range is the one Avery sells across Europe
 * (UK, France, Italy, Spain, and Germany under Avery Zweckform); its US Letter range is North American.
 * The Zweckform-only codes (3474, 3490…) are the German-speaking range.
 */
function sheetCountries(vendor: StockVendor, pageW: number, pageH: number): StockCountry[] {
  const letter = Math.abs(pageW - 215.9) < 1 || Math.abs(pageH - 215.9) < 1;
  switch (vendor) {
    case 'formtec': case 'printec': return ['KR'];
    case 'avery': return letter ? ['US', 'CA'] : ['GB', 'IE', 'FR', 'IT', 'ES', 'DE'];
    case 'zweckform': return ['DE', 'AT', 'CH'];
    case 'aone': return ['JP'];
    default: return ['*'];
  }
}

/** True when the item is sold in `filter` ('all', 'EU' for any European country, or one country). */
export function soldIn(item: StockItem, filter: StockCountry | 'EU' | 'all'): boolean {
  if (filter === 'all' || item.countries.includes('*')) return true;
  if (filter === 'EU') return item.countries.some((c) => EUROPE.includes(c));
  return item.countries.includes(filter);
}

export const STOCK_VENDOR_LABEL: Record<StockVendor, Msg> = {
  formtec: m('폼텍'),
  printec: m('프린텍 애니라벨'),
  avery: m('Avery'),
  zweckform: m('Avery Zweckform'),
  aone: m('A-ONE (일본)'),
  roll: m('롤·라벨 프린터'),
};

const CONF: StockConfidence[] = ['high', 'medium', 'low'];
const r2 = (v: number) => Math.round(v * 100) / 100;

function name(vendor: StockVendor, code: string, p: Paper) {
  const n = p.cols * p.rows;
  return `${t(STOCK_VENDOR_LABEL[vendor])} ${code} (${labelSize(p)}${n > 1 ? ` · ${t('{n}칸', { n })}` : ''})`;
}

const sheets: StockItem[] = SHEETS.map(([vendor, code, category, pw, ph, lw, lh, shape, cols, rows, left, top, px, py, conf, hole]) => {
  const v = vendor as StockVendor;
  const gapX = cols > 1 ? r2(px - lw) : 0, gapY = rows > 1 ? r2(py - lh) : 0;
  return {
    id: `${v}-${code}`, vendor: v, code, category, confidence: CONF[conf], countries: sheetCountries(v, pw, ph),
    paper: () => {
      // corner radius is not published: round labels are circles, spaced labels get the usual 1.5 mm
      const cornerRadius = shape > 0 ? lw / 2 : gapX > 0 || gapY > 0 ? 1.5 : 0;
      const p = makePaper({
        name: '', width: pw, height: ph, labelWidth: lw, labelHeight: lh, cornerRadius, cols, rows,
        marginLeft: left, marginTop: top, gapX, gapY, safeMargin: Math.min(lw, lh) < 15 ? 1 : 1.5,
      });
      p.name = name(v, code, p) + (hole ? ` · ${t('CD 홀 Ø{d}', { d: hole })}` : '');
      return p;
    },
  };
});

/** A roll label; `safe` covers printers that cannot print right up to the edge. */
function rollItem(code: string, w: number, h: number, o: { round?: boolean; safe?: number; category?: string; confidence?: StockConfidence; countries?: StockCountry[] } = {}): StockItem {
  return {
    id: `roll-${code}`, vendor: 'roll', code, category: o.category ?? '', confidence: o.confidence ?? 'medium',
    countries: o.countries ?? ['*'],
    paper: () => {
      const p = roll('', w, h, o.round ? w / 2 : 1.5);
      if (o.safe) p.safeMargin = o.safe;
      p.name = `${code} (${labelSize(p)})`;
      return p;
    },
  };
}

// Formtec roll labels: thermal, art paper and NY film share these 25 sizes (40 mm core).
const FORMTEC_ROLLS = [[30, 10], [30, 15], [30, 20], [35, 15], [40, 20], [40, 30], [45, 25], [45, 50], [50, 30], [50, 50],
  [50, 80], [60, 40], [60, 60], [70, 30], [70, 60], [80, 40], [80, 50], [80, 120], [90, 60], [90, 120],
  [100, 30], [100, 50], [100, 80], [100, 100], [100, 150]];

// Brother QL die-cut rolls: the printable area is smaller than the label (brother_ql label table, 300 dpi).
const DK: [string, number, number, number, number][] = [
  ['DK-11204', 17, 54, 165, 566], ['DK-11203', 17, 87, 165, 956], ['DK-11221', 23, 23, 202, 202],
  ['DK-11201', 29, 90, 306, 991], ['DK-11208', 38, 90, 413, 991], ['DK-11209', 62, 29, 696, 271],
  ['DK-11202', 62, 100, 696, 1109], ['DK-11240', 102, 51, 1164, 526], ['DK-11241', 102, 152, 1164, 1660],
  ['DK-11247', 103, 164, 1200, 1822],
];
const DK_ROUND: [string, number, number][] = [['DK-11219', 12, 94], ['DK-11218', 24, 236], ['DK-11207', 58, 618]];
const dots = (d: number) => (d * 25.4) / 300;

// built on each call: the names follow the UI language
const rolls = (): StockItem[] => [
  ...FORMTEC_ROLLS.map(([w, h]) => rollItem(`${t('폼텍 롤')} ${w}×${h}`, w, h, { category: '롤라벨 감열지 아트지 화이트필름 formtec', countries: ['KR'] })),
  ...DK.map(([code, w, h, pw, ph]) => rollItem(`Brother ${code}`, w, h, { safe: r2(Math.max(w - dots(pw), h - dots(ph)) / 2), category: 'QL', confidence: 'high' })),
  ...DK_ROUND.map(([code, d, pd]) => rollItem(`Brother ${code}`, d, d, { round: true, safe: r2((d - dots(pd)) / 2), category: 'QL', confidence: 'high' })),
  rollItem(t('롯데택배 표준라벨 D'), 100, 200, { category: '택배 운송장 송장', confidence: 'high', countries: ['KR'] }),
  rollItem(t('롯데택배 표준라벨 E'), 100, 122, { category: '택배 운송장 송장', confidence: 'high', countries: ['KR'] }),
  rollItem(t('롯데택배 의류표준 B'), 103, 230, { category: '택배 운송장 송장', confidence: 'high', countries: ['KR'] }),
  rollItem(t('배송 라벨 4×6"'), 101.6, 152.4, { category: '택배 운송장 송장 shipping 100x150', confidence: 'high' }),
];

export function stockItems(): StockItem[] {
  return [...sheets, ...rolls()];
}

/** Matches code, maker, category and size ("3108", "v3230", "99.1x38.1", "14칸" all work). */
export function stockMatches(item: StockItem, paper: Paper, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/[x*]/g, '×').replace(/\s+/g, ' ');
  if (!q) return true;
  const hay = `${item.code} ${t(STOCK_VENDOR_LABEL[item.vendor])} ${item.vendor} ${item.category} ${paper.name} ${labelSize(paper)}`.toLowerCase().replace(/x/g, '×');
  return q.split(' ').every((w) => hay.includes(w));
}
