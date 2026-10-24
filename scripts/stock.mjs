// Builds src/model/stockData.ts from docs/label-stock-specs.json: `npm run stock`.
//
// The JSON is the full spec (sources, notes, alternatives); the app only needs the layout, so each
// sheet becomes one compact row. Edit the JSON (or the spec it was made from), not stockData.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const spec = JSON.parse(readFileSync(root + 'docs/label-stock-specs.json', 'utf8'));
const VENDOR = { Formtec: 'formtec', Printec: 'printec', Avery: 'avery', 'Avery Zweckform': 'zweckform', 'A-ONE': 'aone' };
const SHAPE = { rect: 0, circle: 1, cd: 2 };
const CONF = { high: 0, medium: 1, low: 2 };

const rows = spec.items.map((d) => {
  const v = VENDOR[d.vendor];
  if (!v) throw new Error(`unknown vendor ${d.vendor}`);
  const g = d.grid, l = d.label;
  return JSON.stringify([v, d.code, d.category || '', d.page.w, d.page.h, l.w, l.h, SHAPE[l.shape], g.cols, g.rows,
    g.left, g.top, g.pitchX, g.pitchY, CONF[d.confidence], l.holeDiameter ?? 0]);
});

const out = `// Generated from docs/label-stock-specs.json by \`npm run stock\`. Edit the JSON, not this file.
// vendor, code, category, page w, page h, label w, label h, shape (0 rect, 1 circle, 2 CD), cols, rows,
// left, top, pitch x, pitch y, confidence (0 high, 1 medium, 2 low), CD hole diameter
export type StockRow = [string, string, string, number, number, number, number, number, number, number, number, number, number, number, number, number];

export const SHEETS: StockRow[] = [
${rows.map((r) => `  ${r},`).join('\n')}
];
`;
writeFileSync(root + 'src/model/stockData.ts', out);
console.log(`${rows.length} sheets → src/model/stockData.ts`);
