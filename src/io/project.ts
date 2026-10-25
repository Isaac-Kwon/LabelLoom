import { t } from '../i18n';
import { migrateProject } from '../model/defaults';
import type { Project } from '../model/types';
import { isZipFile, projectFromZip, projectToZip } from './archive';
import { download, safeName } from './export';

export const EXT = '.labelloom.json';
export const ZIP_EXT = '.labelloom.zip';

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

/* ---------- snapshots: earlier states of the work, kept in this browser ---------- */

export interface Snapshot { id: string; name: string; at: string; auto: boolean; project: Project }

const SNAP_KEY = 'snapshots';
const MAX_AUTO = 12, MAX_NAMED = 30;
/** taken automatically this often, but only if the work changed in between */
export const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;

export const loadSnapshots = async () => (await kvGet<Snapshot[]>(SNAP_KEY)) ?? [];

/** Adds a snapshot, newest first; keeps the last MAX_AUTO automatic ones and MAX_NAMED named ones.
 *  An automatic one that matches the newest snapshot is skipped, so it doesn't push out older ones. */
export async function addSnapshot(p: Project, name: string, auto: boolean) {
  const list = await loadSnapshots();
  if (auto && list[0] && JSON.stringify(list[0].project) === JSON.stringify(p)) return;
  const s: Snapshot = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, at: new Date().toISOString(), auto, project: p };
  const next = [s, ...list];
  const autos = next.filter((x) => x.auto).slice(0, MAX_AUTO), named = next.filter((x) => !x.auto).slice(0, MAX_NAMED);
  await kvSet(SNAP_KEY, next.filter((x) => autos.includes(x) || named.includes(x)));
}

export async function deleteSnapshot(id: string) {
  await kvSet(SNAP_KEY, (await loadSnapshots()).filter((x) => x.id !== id));
}

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

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((res) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => res([...(input.files ?? [])]);
    input.oncancel = () => res([]);
    input.click();
  });
}

export async function openProjectFile(): Promise<{ project: Project; name: string } | null> {
  const w = window as PickerWindow;
  let file: File | null = null;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: t('LabelLoom 프로젝트'), accept: { 'application/json': ['.json'], 'application/zip': ['.zip'] } }] });
      file = await h.getFile();
      handle = isZipFile(file) ? null : h; // Ctrl+S writes JSON, so it must not go back into a ZIP
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
    }
  }
  if (!file) { handle = null; file = await pickFile(PROJECT_ACCEPT); }
  if (!file) return null;
  return { project: await readProjectFile(file), name: file.name };
}

export const PROJECT_ACCEPT = '.json,application/json,.zip,application/zip';
export const isProjectFile = (f: File) => /\.json$/i.test(f.name) || isZipFile(f);

/** A .json project or a .zip made by saveProjectZip. */
export async function readProjectFile(f: File): Promise<Project> {
  return isZipFile(f) ? migrateProject(await projectFromZip(f)) : parseProject(await f.text());
}

/** Project with its pictures and fonts as separate files in a ZIP (original bytes); returns the file name. */
export async function saveProjectZip(p: Project): Promise<string> {
  const name = safeName(p.name) + ZIP_EXT;
  download(await projectToZip(p), name);
  return name;
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
