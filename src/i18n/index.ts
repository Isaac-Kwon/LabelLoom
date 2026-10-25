import { createElement, Fragment, type ReactNode } from 'react';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { pt } from './pt';
import { ur } from './ur';

/**
 * UI language. The Korean text is the message key (and the Korean translation), so code reads
 * as before; en.ts lists every key and the other languages must match it (TypeScript checks both ways).
 * Every dictionary is generated from src/i18n/messages.tsv (npm run i18n), so a new message is
 * one line there: Korean, English, Italian, French, Portuguese, Spanish, German, Urdu separated by tabs.
 *
 *   t('저장했습니다: {name}', { name })   text, with {placeholders}
 *   tn('… {link} …', { link: <b>…</b> })  same, with React nodes in the placeholders
 *   m('선택')                              marks a constant for t() later (checked, returned as is)
 *   tx(name)                               translates data that may be a key (preset names), else returns it
 */

export type Lang = 'ko' | 'en' | 'it' | 'fr' | 'pt' | 'es' | 'de' | 'ur';
export type Msg = keyof typeof en;
type Vars = Record<string, string | number>;

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italiano' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ur', label: 'اردو' },
];

const DICT: Record<Exclude<Lang, 'ko'>, Record<Msg, string>> = { en, it, fr, pt, es, de, ur };
const LOCALE: Record<Lang, string> = { ko: 'ko-KR', en: 'en-US', it: 'it-IT', fr: 'fr-FR', pt: 'pt-BR', es: 'es-ES', de: 'de-DE', ur: 'ur-PK' };
const KEY = 'labelloom.lang';
const isLang = (s: string | null): s is Lang => LANGS.some((l) => l.value === s);

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch { /* storage unavailable */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const p = l.slice(0, 2).toLowerCase();
    if (isLang(p)) return p;
  }
  return 'en';
}

let lang: Lang = detect();
document.documentElement.lang = lang;

const subs = new Set<() => void>();
export const getLang = () => lang;
/** BCP 47 locale for dates, numbers and sorting. */
export const locale = () => LOCALE[lang];
export const subscribeLang = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  subs.forEach((f) => f());
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
/** A key may end in "#context" when the same Korean word needs different translations ('전체#plenary'). */
const text = (key: Msg) => (lang === 'ko' ? key.replace(/#\w+$/, '') : DICT[lang][key] ?? key);

export function t(key: Msg, vars?: Vars): string {
  return fill(text(key), vars);
}

export function tn(key: Msg, nodes: Record<string, ReactNode>): ReactNode {
  const s = text(key);
  const parts = s.split(/\{(\w+)\}/).map((p, i) => (i % 2 ? (p in nodes ? nodes[p] : `{${p}}`) : p));
  return createElement(Fragment, null, ...parts);
}

export const m = (key: Msg): Msg => key;

export function tx(s: string): string {
  return lang !== 'ko' && s in DICT[lang] ? DICT[lang][s as Msg] : s;
}

/** A message in every language, for reading files written in any of them. */
export const everyLang = (key: Msg): string[] => [...new Set([key, ...Object.values(DICT).map((d) => d[key])])];

/** Value in the current language from a plain string or { ko, en, it, … } (about.json). */
export function loc(v: string | Partial<Record<Lang, string>>): string {
  return typeof v === 'string' ? v : v[lang] ?? v.en ?? v.ko ?? '';
}

/** Pick per-language data, such as a template's sample rows. */
export const pick = <T>(v: Record<Lang, T>): T => v[lang];
