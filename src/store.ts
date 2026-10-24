import { create } from 'zustand';
import { m, t } from './i18n';
import { newDesign, newObject, newProject, uid } from './model/defaults';
import { PAPER_PRESETS } from './model/presets';
import type { Design, LabelObject, ObjType, Project } from './model/types';

export type Tool = 'select' | ObjType;
export type Side = 'front' | 'back';
export type Dialog =
  | null | 'export' | 'import' | 'serial' | 'share' | 'start' | 'designRules' | 'reprint'
  | 'calibration' | 'shortcuts' | 'components' | 'fonts' | 'presets' | 'quick' | 'about' | 'preprint' | 'table' | 'help' | 'replace' | 'remap' | 'snapshots';

/** Cells picked inside a table being edited on the canvas: the active cell and the other corner of the range. */
export interface CellSel { id: string; r: number; c: number; ar: number; ac: number }

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selection: string[];
  designId: string;
  side: Side;
  tool: Tool;
  zoom: number; // px per mm
  currentRow: number;
  filter: { text: string; column: string; value: string };
  dialog: Dialog;
  dialogArg?: unknown;
  fileName: string;
  toast: string;
  clipboard: LabelObject[];
  /** set while a table is edited cell by cell on the canvas */
  cellSel: CellSel | null;
  /** state of the last fetch from project.dataSource */
  sync: SyncState;
  /** guided tour in progress: lesson id and step index */
  tour: { lesson: string; step: number } | null;
}

export interface SyncState { busy: boolean; at?: string; error?: string }

interface Actions {
  /** Replace the project, recording history unless `noHistory`. */
  setProject(p: Project, opts?: { noHistory?: boolean; resetView?: boolean }): void;
  commit(fn: (p: Project) => Project): void;
  /** Record a history step without changing anything (start of a drag). */
  checkpoint(): void;
  /** Update without history (during drags after checkpoint). */
  live(fn: (p: Project) => Project): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  setTool(t: Tool): void;
  setZoom(z: number): void;
  setDesign(id: string, side?: Side): void;
  setCurrentRow(i: number): void;
  setFilter(f: Partial<State['filter']>): void;
  open(d: Dialog, arg?: unknown): void;
  close(): void;
  notify(msg: string): void;
  setFileName(n: string): void;
  setClipboard(objs: LabelObject[]): void;
  setCellSel(c: CellSel | null): void;
  setSync(s: Partial<SyncState>): void;
  setTour(t: State['tour']): void;
}

const HISTORY = 100;

const initialPaper = PAPER_PRESETS[2].items[0];

export const useStore = create<State & Actions>((set, get) => {
  const first = newProject(initialPaper);
  return {
    project: first,
    past: [],
    future: [],
    selection: [],
    designId: first.designs[0].id,
    side: 'front',
    tool: 'select',
    zoom: 4,
    currentRow: 0,
    filter: { text: '', column: '', value: '' },
    dialog: null,
    fileName: '',
    toast: '',
    clipboard: [],
    cellSel: null,
    sync: { busy: false },
    tour: null,

    setProject(p, opts) {
      const s = get();
      const keep = p.designs.some((d) => d.id === s.designId);
      set({
        project: p,
        past: opts?.noHistory ? s.past : [...s.past, s.project].slice(-HISTORY),
        future: opts?.noHistory ? s.future : [],
        designId: keep ? s.designId : p.designs[0].id,
        side: keep ? s.side : 'front',
        selection: opts?.resetView ? [] : s.selection,
        currentRow: opts?.resetView ? 0 : Math.min(s.currentRow, Math.max(0, p.data.rows.length - 1)),
      });
    },
    commit(fn) {
      const s = get();
      const next = fn(s.project);
      if (next === s.project) return;
      set({ project: next, past: [...s.past, s.project].slice(-HISTORY), future: [] });
    },
    checkpoint() {
      const s = get();
      set({ past: [...s.past, s.project].slice(-HISTORY), future: [] });
    },
    live(fn) {
      set({ project: fn(get().project) });
    },
    undo() {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future] });
      fixView();
    },
    redo() {
      const s = get();
      if (!s.future.length) return;
      const [next, ...rest] = s.future;
      set({ project: next, past: [...s.past, s.project], future: rest });
      fixView();
    },
    select(ids) {
      const c = get().cellSel;
      set({ selection: ids, cellSel: c && ids.length === 1 && ids[0] === c.id ? c : null });
    },
    setTool: (t) => set({ tool: t }),
    setZoom: (z) => set({ zoom: Math.min(60, Math.max(0.5, z)) }),
    setDesign: (id, side) => set({ designId: id, side: side ?? 'front', selection: [], cellSel: null }),
    setCurrentRow: (i) => set({ currentRow: i }),
    setFilter: (f) => set({ filter: { ...get().filter, ...f } }),
    open: (d, arg) => set({ dialog: d, dialogArg: arg }),
    close: () => set({ dialog: null, dialogArg: undefined }),
    notify(msg) {
      set({ toast: msg });
      window.clearTimeout((window as unknown as { __toast?: number }).__toast);
      (window as unknown as { __toast?: number }).__toast = window.setTimeout(() => set({ toast: '' }), 3200);
    },
    setFileName: (n) => set({ fileName: n }),
    setClipboard: (objs) => set({ clipboard: objs }),
    setCellSel: (c) => set({ cellSel: c }),
    setSync: (x) => set({ sync: { ...get().sync, ...x } }),
    setTour: (x) => set({ tour: x }),
  };

  function fixView() {
    const s = get();
    if (!s.project.designs.some((d) => d.id === s.designId)) set({ designId: s.project.designs[0].id, side: 'front' });
    const ids = new Set(currentObjects(get()).map((o) => o.id));
    const selection = s.selection.filter((id) => ids.has(id));
    set({ selection, cellSel: s.cellSel && selection.includes(s.cellSel.id) ? s.cellSel : null });
  }
});

/* ---------- selectors & pure helpers ---------- */

export function currentDesign(s: { project: Project; designId: string }): Design {
  return s.project.designs.find((d) => d.id === s.designId) ?? s.project.designs[0];
}

export function currentObjects(s: { project: Project; designId: string; side: Side }): LabelObject[] {
  const d = currentDesign(s);
  return (s.side === 'back' ? d.back : d.objects) ?? [];
}

export function mapObjects(p: Project, designId: string, side: Side, fn: (objs: LabelObject[]) => LabelObject[]): Project {
  return {
    ...p,
    designs: p.designs.map((d) => {
      if (d.id !== designId) return d;
      return side === 'back' ? { ...d, back: fn(d.back ?? []) } : { ...d, objects: fn(d.objects) };
    }),
  };
}

/** Convenience actions bound to the current design/side. */
export const act = {
  editObjects(fn: (objs: LabelObject[]) => LabelObject[], live = false) {
    const s = useStore.getState();
    const f = (p: Project) => mapObjects(p, s.designId, s.side, fn);
    if (live) s.live(f); else s.commit(f);
  },
  update(ids: string[], patch: Partial<LabelObject> | ((o: LabelObject) => Partial<LabelObject>), live = false) {
    const set = new Set(ids);
    act.editObjects((objs) => objs.map((o) => (set.has(o.id) ? ({ ...o, ...(typeof patch === 'function' ? patch(o) : patch) } as LabelObject) : o)), live);
  },
  add(type: ObjType, x?: number, y?: number, w?: number, h?: number, extra?: Partial<LabelObject>) {
    const o = { ...newObject(type, x, y, w, h), ...extra } as LabelObject;
    const objs = currentObjects(useStore.getState());
    o.name = `${t(NAME_OF[type])} ${objs.filter((x) => x.type === type).length + 1}`;
    act.editObjects((list) => [...list, o]);
    useStore.getState().select([o.id]);
    useStore.getState().setTool('select');
    return o;
  },
  insert(objs: LabelObject[], offset = 0) {
    const groupMap = new Map<string, string>();
    const copies = objs.map((o) => {
      let groupId = o.groupId;
      if (groupId) { if (!groupMap.has(groupId)) groupMap.set(groupId, uid()); groupId = groupMap.get(groupId); }
      return { ...structuredClone(o), id: uid(), x: o.x + offset, y: o.y + offset, groupId } as LabelObject;
    });
    act.editObjects((list) => [...list, ...copies]);
    useStore.getState().select(copies.map((c) => c.id));
    return copies;
  },
  removeSelected() {
    const s = useStore.getState();
    const set = new Set(s.selection);
    if (!set.size) return;
    act.editObjects((objs) => objs.filter((o) => !set.has(o.id) || o.locked));
    s.select([]);
  },
  addDesign(copyFrom?: Design) {
    const s = useStore.getState();
    const d = copyFrom
      ? { ...structuredClone(copyFrom), id: uid(), name: t('{name} 복사본', { name: copyFrom.name }) }
      : newDesign(t('디자인 {n}', { n: s.project.designs.length + 1 }));
    s.commit((p) => ({ ...p, designs: [...p.designs, d] }));
    s.setDesign(d.id);
  },
};

const NAME_OF: Record<ObjType, ReturnType<typeof m>> = {
  text: m('텍스트'), rect: m('사각형'), ellipse: m('원'), triangle: m('삼각형'), line: m('선'),
  barcode: m('바코드'), qr: m('QR'), image: m('이미지'), svg: m('SVG'), table: m('표'),
};

/** Expand a selection to whole groups. */
export function expandGroups(objs: LabelObject[], ids: string[]): string[] {
  const groups = new Set(objs.filter((o) => ids.includes(o.id) && o.groupId).map((o) => o.groupId));
  if (!groups.size) return ids;
  return [...new Set([...ids, ...objs.filter((o) => o.groupId && groups.has(o.groupId)).map((o) => o.id)])];
}
