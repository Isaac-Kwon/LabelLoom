// Builds src/i18n/{en,it,fr}.ts from src/i18n/messages.tsv: `npm run i18n`.
//
// messages.tsv has one message per line: the Korean text (the key used in t('…')), then its
// English, Italian and French translations, separated by tabs. "\n" stands for a line break,
// lines starting with # are comments. The Korean text may end in "#context" when the same
// words need different translations in different places ('전체#plenary').
// The script stops on a missing column, a repeated key or a {placeholder} that differs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const [head, ...lines] = readFileSync(dir + 'messages.tsv', 'utf8').replace(/\r\n/g, '\n').split('\n');
const langs = head.split('\t').slice(1);
const out = Object.fromEntries(langs.map((l) => [l, []]));
const seen = new Set();
const errors = [];
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const unescape = (s) => s.replace(/\\n/g, '\n');

lines.forEach((line, i) => {
  if (!line.trim() || line.startsWith('#')) return;
  const [key, ...tr] = line.split('\t').map(unescape);
  const at = `messages.tsv:${i + 2}`;
  if (tr.length !== langs.length || tr.some((s) => !s)) return errors.push(`${at}: needs ${langs.length + 1} columns`);
  if (seen.has(key)) return errors.push(`${at}: repeated key ${JSON.stringify(key)}`);
  seen.add(key);
  tr.forEach((s, j) => {
    if (vars(s) !== vars(key)) errors.push(`${at}: ${langs[j]} placeholders {${vars(s)}} differ from {${vars(key)}}`);
    out[langs[j]].push(`  ${JSON.stringify(key)}: ${JSON.stringify(s)},`);
  });
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const note = '// Generated from messages.tsv by `npm run i18n`. Edit messages.tsv, not this file.\n';
langs.forEach((l, j) => {
  // en.ts defines the keys (Msg); the others must have exactly the same ones
  const decl = j === 0 ? `export const ${l} = {` : `import type { Msg } from '.';\n\nexport const ${l}: Record<Msg, string> = {`;
  writeFileSync(`${dir}${l}.ts`, `${note}${decl}\n${out[l].join('\n')}\n};\n`);
});
console.log(`${seen.size} messages → ${langs.map((l) => `${l}.ts`).join(', ')}`);
