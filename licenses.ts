import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * License texts of LabelLoom and of every runtime npm package it bundles.
 * They are exposed to the app as `virtual:licenses`, so a page that imports them still carries them when saved,
 * and the build also writes dist/THIRD_PARTY_LICENSES.txt.
 */

const ID = 'virtual:licenses';
const ROOT = dirname(fileURLToPath(import.meta.url));
const LICENSE_FILE = /^(licen[cs]e|copying)([-_.]|$)/i;

interface Pkg { name: string; version: string; license: string; homepage: string; text: string }

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** Node resolution: the package folder in the nearest node_modules above `from`. */
function findPkg(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const p = join(dir, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) return p;
    if (dirname(dir) === dir) return undefined;
  }
}

function licenseText(dir: string): string {
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  if (files.length) return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
  // Some small packages only have the license in their README.
  const readme = readdirSync(dir).find((f) => /^readme/i.test(f));
  const m = readme && readFileSync(join(dir, readme), 'utf8').match(/^#+\s*licen[cs]e\s*\n([\s\S]*?)(?=\n#+\s|$)/im);
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
}

/** Runtime dependencies (including optional ones, which jsPDF bundles) of package.json, recursively. */
function collect(): Pkg[] {
  const seen = new Map<string, Pkg>();
  const visit = (deps: Record<string, string> | undefined, from: string) => {
    for (const name of Object.keys(deps ?? {})) {
      if (name.startsWith('@types/')) continue; // type declarations only, nothing is bundled
      const dir = findPkg(name, from);
      if (!dir) continue;
      const j = readJson(join(dir, 'package.json'));
      const key = `${j.name}@${j.version}`;
      if (seen.has(key)) continue;
      const license = typeof j.license === 'string' ? j.license : (j.licenses ?? []).map((l: { type: string }) => l.type).join(' OR ');
      const repo = typeof j.repository === 'string' ? j.repository : j.repository?.url ?? '';
      seen.set(key, { name: j.name, version: j.version, license, homepage: j.homepage || repo.replace(/^git\+/, '').replace(/\.git$/, ''), text: licenseText(dir) });
      visit({ ...j.dependencies, ...j.optionalDependencies }, dir);
    }
  };
  visit(readJson(join(ROOT, 'package.json')).dependencies, ROOT);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function thirdPartyText(pkgs: Pkg[]): string {
  const line = '='.repeat(78);
  const head = `LabelLoom에 포함된 서드파티 소프트웨어 / Third-party software bundled in LabelLoom\n\n${pkgs.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n')}\n`;
  const body = pkgs.map((p) => `${line}\n${p.name} ${p.version}\nLicense: ${p.license}${p.homepage ? `\n${p.homepage}` : ''}\n${line}\n\n${p.text || '(라이선스 전문이 패키지에 없습니다 / License text not included in the package)'}\n`);
  return [head, ...body].join('\n');
}

export const licenses = (): Plugin => {
  let third = '';
  const get = () => (third ||= thirdPartyText(collect()));
  return {
    name: 'labelloom-licenses',
    resolveId: (id) => (id === ID ? '\0' + ID : undefined),
    load(id) {
      if (id !== '\0' + ID) return;
      const own = ['COPYING.LESSER', 'COPYING'].map((f) => readFileSync(join(ROOT, f), 'utf8').trim()).join('\n\n\n');
      return `export const OWN_LICENSE = ${JSON.stringify(own)};\nexport const THIRD_PARTY_LICENSES = ${JSON.stringify(get())};\n`;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: get() });
    },
  };
};
