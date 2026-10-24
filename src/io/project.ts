import { t } from '../i18n';
import { migrateProject } from '../model/defaults';
import type { Project } from '../model/types';
import { download, safeName } from './export';

export const EXT = '.labelloom.json';

/* ---------- tiny IndexedDB key-value store ---------- */

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('labelloom', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result as T);
      q.onerror = () => rej(q.error);
    });
  } catch { return undefined; }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch { /* private mode etc. */ }
}

/* ---------- autosave & recent ---------- */

export interface RecentEntry { id: string; name: string; savedAt: string; project: Project }

export const saveAutosave = (p: Project) => kvSet('autosave', p);
export const loadAutosave = () => kvGet<Project>('autosave');

export async function pushRecent(p: Project) {
  const list = (await kvGet<RecentEntry[]>('recent')) ?? [];
  const entry: RecentEntry = { id: p.name, name: p.name, savedAt: new Date().toISOString(), project: p };
  await kvSet('recent', [entry, ...list.filter((x) => x.name !== p.name)].slice(0, 8));
}
export const loadRecent = async () => (await kvGet<RecentEntry[]>('recent')) ?? [];

/* ---------- JSON files ---------- */

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
};
let handle: FileSystemFileHandle | null = null;

export function serialize(p: Project, opts: { includeData?: boolean; includeFonts?: boolean } = {}): string {
  const out: Project = {
    ...p,
    data: opts.includeData === false ? { columns: p.data.columns, rows: [] } : p.data,
    fonts: opts.includeFonts === false ? [] : p.fonts,
  };
  return JSON.stringify(out, null, 1);
}

export async function saveProjectFile(p: Project, saveAs = false): Promise<string | null> {
  const json = serialize(p);
  const w = window as PickerWindow;
  const suggested = safeName(p.name) + EXT;
  if (w.showSaveFilePicker) {
    try {
      if (!handle || saveAs) {
        handle = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: t('LabelLoom 프로젝트'), accept: { 'application/json': ['.json'] } }] });
      }
      const ws = await handle.createWritable();
      await ws.write(json);
      await ws.close();
      return handle.name;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      handle = null; // fall through to download
    }
  }
  download(new Blob([json], { type: 'application/json' }), suggested);
  return suggested;
}

export function forgetFileHandle() { handle = null; }

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => res(input.files?.[0] ?? null);
    input.oncancel = () => res(null);
    input.click();
  });
}

export async function openProjectFile(): Promise<{ project: Project; name: string } | null> {
  const w = window as PickerWindow;
  let file: File | null = null;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: t('LabelLoom 프로젝트'), accept: { 'application/json': ['.json'] } }] });
      handle = h;
      file = await h.getFile();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
    }
  }
  if (!file) { handle = null; file = await pickFile('.json,application/json'); }
  if (!file) return null;
  return { project: parseProject(await file.text()), name: file.name };
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(t('JSON 형식이 올바르지 않습니다.')); }
  return migrateProject(raw);
}

export const readAsDataURL = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as string);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});
