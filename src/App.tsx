import { useCallback, useEffect, useState } from 'react';
import { version } from '../package.json';
import { registerFonts } from './io/fonts';
import { forgetFileHandle, loadAutosave, openProjectFile, parseProject, pushRecent, saveAutosave, saveProjectFile } from './io/project';
import { decodeShare, readShareHash } from './io/share';
import { migrateProject } from './model/defaults';
import type { Project } from './model/types';
import { useStore } from './store';
import { act } from './store';
import { Canvas, isTyping } from './ui/Canvas';
import { DataPanel } from './ui/DataPanel';
import { CalibrationDialog, FontsDialog, ReprintDialog, SerialDialog, ShareDialog, ShortcutsDialog, StartDialog } from './ui/Dialogs';
import { ExportDialog } from './ui/ExportDialog';
import { ImportDialog } from './ui/ImportDialog';
import { QuickDialog } from './ui/QuickPrint';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/LeftPanel';
import { loadMediaInto } from './ui/media';
import { copy, duplicate, group, nudge, paste, reorder, selectAll, ungroup } from './ui/ops';
import { CanvasBar, Toolbar } from './ui/Toolbar';

const COMMIT = import.meta.env.VITE_COMMIT_SHA?.slice(0, 7);
const BUILT = new Date(__BUILD_TIME__);
const pad = (n: number) => String(n).padStart(2, '0');
const BUILD_LABEL = `v${version} · ${COMMIT ?? 'dev'} · ${BUILT.getFullYear()}-${pad(BUILT.getMonth() + 1)}-${pad(BUILT.getDate())} ${pad(BUILT.getHours())}:${pad(BUILT.getMinutes())}`;

const TOOL_KEYS: Record<string, Parameters<ReturnType<typeof useStore.getState>['setTool']>[0]> = {
  v: 'select', t: 'text', r: 'rect', o: 'ellipse', l: 'line', b: 'barcode', q: 'qr', i: 'image',
};

/** Startup state for this page. App remounts when coming back from the quick print page, and StrictMode runs effects twice in dev. */
const boot = { started: false, done: false, initial: undefined as Project | undefined };

export default function App({ initial, onQuick }: { initial?: Project; onQuick: () => void }) {
  const dialog = useStore((s) => s.dialog);
  const toast = useStore((s) => s.toast);
  const project = useStore((s) => s.project);
  const [dataH, setDataH] = useState(() => Number(localStorage.getItem('labelloom.dataH')) || 220);
  const [ready, setReady] = useState(false);
  const [dropping, setDropping] = useState(false);

  const loadProject = useCallback((p: Project, name = '') => {
    const s = useStore.getState();
    s.setProject(p, { resetView: true });
    s.setDesign(p.designs[0].id);
    s.setFileName(name);
    forgetFileHandle();
    void registerFonts(p);
    setTimeout(() => window.dispatchEvent(new Event('labelloom:fit')), 0);
  }, []);

  /* ---------- startup: template from quick print → share link → autosave → start screen ---------- */
  useEffect(() => {
    const fresh = initial && initial !== boot.initial;
    if (!fresh && boot.started) {
      // back from quick print with the same work (still in the store), or StrictMode's second run
      if (boot.done) setReady(true);
      return;
    }
    boot.started = true;
    boot.initial = initial;
    /** Open p in place of the autosaved work, which is kept in the recent list (after asking). */
    const adopt = async (p: Project, what: string, done: string) => {
      const prev = await loadAutosave();
      if (!prev || confirm(`${what} "${p.name}"을(를) 엽니다.\n지금 작업 중인 내용은 "최근 저장한 작업"에 보관됩니다.`)) {
        if (prev) await pushRecent(migrateProject(prev));
        loadProject(p);
        useStore.getState().notify(done);
      } else if (prev) loadProject(migrateProject(prev));
    };
    (async () => {
      const share = readShareHash();
      const s = useStore.getState();
      if (initial) {
        await adopt(initial, '빠른 출력 템플릿', '빠른 출력 템플릿을 편집기에서 열었습니다.');
      } else if (share) {
        try {
          await adopt(await decodeShare(share.code), '공유된 디자인', '공유 링크에서 디자인을 불러왔습니다.');
        } catch (e) {
          s.notify('공유 링크를 읽을 수 없습니다: ' + (e as Error).message);
        }
        history.replaceState(null, '', location.pathname + location.search);
      } else {
        const prev = await loadAutosave();
        if (prev) {
          try { loadProject(migrateProject(prev)); } catch { s.open('start'); }
        } else s.open('start');
      }
      boot.done = true;
      setReady(true);
    })();
  }, [loadProject, initial]);

  /* ---------- autosave ---------- */
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void saveAutosave(project), 800);
    return () => clearTimeout(t);
  }, [project, ready]);

  useEffect(() => { try { localStorage.setItem('labelloom.dataH', String(dataH)); } catch { /* ignore */ } }, [dataH]);

  const onSave = useCallback(async (saveAs = false) => {
    const s = useStore.getState();
    const name = await saveProjectFile(s.project, saveAs);
    if (name) { s.setFileName(name); s.notify(`저장했습니다: ${name}`); void pushRecent(s.project); }
  }, []);
  const onOpen = useCallback(async () => {
    try {
      const r = await openProjectFile();
      if (r) loadProject(r.project, r.name);
    } catch (e) { useStore.getState().notify((e as Error).message); }
  }, [loadProject]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void onSave(e.shiftKey); return; }
      if (mod && k === 'o') { e.preventDefault(); void onOpen(); return; }
      if (mod && k === 'p') { e.preventDefault(); s.open('export'); return; }
      if (s.dialog || isTyping()) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k === 'c') { e.preventDefault(); copy(); return; }
      if (mod && k === 'x') { e.preventDefault(); copy(true); return; }
      if (mod && k === 'v') { e.preventDefault(); paste(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return; }
      if (mod && (e.key === ']' || e.code === 'BracketRight')) { e.preventDefault(); reorder(e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && (e.key === '[' || e.code === 'BracketLeft')) { e.preventDefault(); reorder(e.shiftKey ? 'back' : 'backward'); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); s.setZoom(s.zoom * 1.25); return; }
      if (mod && k === '-') { e.preventDefault(); s.setZoom(s.zoom / 1.25); return; }
      if (mod && k === '0') { e.preventDefault(); window.dispatchEvent(new Event('labelloom:fit')); return; }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act.removeSelected(); return; }
      if (e.key === 'Escape') { s.select([]); s.setTool('select'); return; }
      if (e.key === '?') { s.open('shortcuts'); return; }
      if (e.key === 'PageDown') { e.preventDefault(); s.setCurrentRow(Math.min(s.project.data.rows.length - 1, s.currentRow + 1)); return; }
      if (e.key === 'PageUp') { e.preventDefault(); s.setCurrentRow(Math.max(0, s.currentRow - 1)); return; }
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); return; }
      if (TOOL_KEYS[k] && !e.altKey) s.setTool(TOOL_KEYS[k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onOpen]);

  /* ---------- drag & drop files ---------- */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const s = useStore.getState();
    if (/\.json$/i.test(f.name)) {
      try { loadProject(parseProject(await f.text()), f.name); } catch (err) { s.notify((err as Error).message); }
    } else if (/\.(xlsx|xls|xlsm|csv|tsv|ods)$/i.test(f.name)) {
      s.open('import', f);
    } else if (/^image\//.test(f.type) || /\.svg$/i.test(f.name)) {
      const isSvg = /\.svg$/i.test(f.name) || f.type === 'image/svg+xml';
      const o = act.add(isSvg ? 'svg' : 'image', 5, 5, Math.min(30, s.project.paper.labelWidth / 2), Math.min(30, s.project.paper.labelHeight / 2));
      await loadMediaInto(o.id, f);
    }
  };

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }} onDrop={onDrop}>
      <Toolbar onOpen={onOpen} onSave={onSave} />
      <div className="main">
        <LeftPanel />
        <div className="center">
          <CanvasBar />
          <Canvas />
        </div>
        <aside className="right-panel"><div className="panel-scroll"><Inspector /></div></aside>
      </div>
      <DataPanel height={dataH} onResize={setDataH} />
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'import' && <ImportDialog />}
      {dialog === 'serial' && <SerialDialog />}
      {dialog === 'share' && <ShareDialog />}
      {dialog === 'start' && <StartDialog onLoad={loadProject} />}
      {dialog === 'reprint' && <ReprintDialog />}
      {dialog === 'quick' && <QuickDialog onFullscreen={onQuick} />}
      {dialog === 'calibration' && <CalibrationDialog />}
      {dialog === 'fonts' && <FontsDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dropping && <div className="drop-overlay">파일을 놓으세요 — .json 프로젝트 · xlsx/csv 데이터 · 이미지/SVG</div>}
      {toast && <div className="toast">{toast}</div>}
      <div className="build-tag" title={[import.meta.env.VITE_COMMIT_SHA, __BUILD_TIME__].filter(Boolean).join(' · ')}>{BUILD_LABEL}</div>
    </div>
  );
}
