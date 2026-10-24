import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { buildItems, DEFAULT_DUPLEX, jobFold, paginate, projectDuplex, type JobOptions } from '../render/jobs';
import { preprintSheetMarkup } from '../render/preprint';
import { pickDesign, previewCtx } from '../render/resolve';
import { labelDocument, sheetDocument } from '../render/svg';
import { useStore } from '../store';
import { docUrl } from '../tutorial/lessons';
import { loadExportSettings } from './ExportDialog';
import { Seg } from './controls';
import { LangSelect } from './Toolbar';

/** Phones: the editor does not fit, so the design is only shown — one label per row, or the printed sheets. Like Figma's mobile viewer. */

const QUERY = '(max-width: 640px), (max-height: 480px)';
const FORCE_KEY = 'labelloom.forceEditor'; // this tab only: a new visit shows the viewer again

const media = () => window.matchMedia(QUERY);
export function useSmallScreen() {
  return useSyncExternalStore((f) => { const q = media(); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, () => media().matches);
}
export const editorForced = () => { try { return sessionStorage.getItem(FORCE_KEY) === '1'; } catch { return false; } };
const forceEditor = () => { try { sessionStorage.setItem(FORCE_KEY, '1'); } catch { /* ignore */ } };
export const unforceEditor = () => { try { sessionStorage.removeItem(FORCE_KEY); } catch { /* ignore */ } };

/** Horizontal swipe → prev / next. */
function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onPrev(); else onNext();
    },
    onPointerCancel: () => { start.current = null; },
  };
}

function Pager({ at, count, onGo, label }: { at: number; count: number; onGo: (i: number) => void; label?: string }) {
  return (
    <div className="small-pager">
      <button disabled={at <= 0} onClick={() => onGo(at - 1)} aria-label={t('이전')}>◀</button>
      <span className="small-pager-at">
        <strong>{at + 1} / {count}</strong>
        {label && <span className="muted ellipsis">{label}</span>}
      </span>
      <button disabled={at >= count - 1} onClick={() => onGo(at + 1)} aria-label={t('다음')}>▶</button>
    </div>
  );
}

function LabelView() {
  const project = useStore((s) => s.project);
  const rows = project.data.rows;
  const [at, setAt] = useState(() => Math.min(useStore.getState().currentRow, Math.max(0, rows.length - 1)));
  const count = Math.max(1, rows.length);
  const i = Math.min(at, count - 1);
  const go = (n: number) => setAt(Math.max(0, Math.min(count - 1, n)));
  const swipe = useSwipe(() => go(i - 1), () => go(i + 1));

  const row = rows[i];
  const svg = useMemo(() => {
    const d = pickDesign(project, row);
    const ctx = previewCtx(row, i, project.seqStart);
    return {
      front: labelDocument(project, d.objects, ctx, { white: true }),
      back: d.back?.length ? labelDocument(project, d.back, ctx, { white: true }) : '',
      design: project.designs.length > 1 ? d.name : '',
    };
  }, [project, row, i]);
  const summary = row ? project.data.columns.map((c) => row.values[c]?.trim()).filter(Boolean).slice(0, 3).join(' · ') : '';

  return (
    <>
      <div className="small-stage" {...swipe}>
        <figure><div className="small-svg" dangerouslySetInnerHTML={{ __html: svg.front }} />{svg.back && <figcaption>{t('앞면')}</figcaption>}</figure>
        {svg.back && <figure><div className="small-svg" dangerouslySetInnerHTML={{ __html: svg.back }} /><figcaption>{t('뒷면')}</figcaption></figure>}
      </div>
      {count > 1 && <Pager at={i} count={count} onGo={go} label={[summary, svg.design].filter(Boolean).join(' — ')} />}
      {count <= 1 && svg.design && <p className="muted small center-text">{svg.design}</p>}
    </>
  );
}

function SheetView() {
  const project = useStore((s) => s.project);
  const [page, setPage] = useState(0);
  const { pages, fold, mirror } = useMemo(() => {
    // the print dialog's defaults: checked rows, the template's saved duplex layout
    const hasBack = project.designs.some((d) => d.back?.length);
    const d = projectDuplex(project, loadExportSettings());
    const job: JobOptions = {
      ...DEFAULT_DUPLEX, scope: 'checked', rangeFrom: 1, rangeTo: project.data.rows.length || 1, currentRow: 0, copies: 1,
      blankCount: project.paper.cols * project.paper.rows, startCell: 1,
      duplex: hasBack && !!project.duplex, duplexMode: d.mode, mirror: d.mirror, foldDir: d.foldDir, foldRotate: d.foldRotate,
    };
    const fold = jobFold(job);
    return { pages: paginate(project, buildItems(project, job), { startCell: 1, duplex: job.duplex && !fold, fold }), fold, mirror: job.mirror };
  }, [project]);
  const p = Math.min(page, pages.length - 1);
  const go = (n: number) => setPage(Math.max(0, Math.min(pages.length - 1, n)));
  const swipe = useSwipe(() => go(p - 1), () => go(p + 1));

  const svg = useMemo(() => {
    const pg = pages[p];
    if (!pg) return '';
    const s = sheetDocument(project, pg.cells, { outlines: true, calibrate: false, mirror: pg.back ? mirror : 'none', fold }, 999);
    return !pg.back && !fold ? s.replace(/<\/svg>$/, preprintSheetMarkup(project.paper) + '</svg>') : s;
  }, [pages, p, project, fold, mirror]);

  if (!pages.length) return <p className="muted small-empty">{t('출력할 라벨이 없습니다. 대상이나 인쇄 체크를 확인하세요.')}</p>;
  return (
    <>
      <div className="small-stage" {...swipe}><div className="small-svg sheet" dangerouslySetInnerHTML={{ __html: svg }} /></div>
      {pages.length > 1 && <Pager at={p} count={pages.length} onGo={go} label={pages[p]?.back ? t('뒷면') : undefined} />}
    </>
  );
}

export function SmallScreen({ onEditor, onQuick }: { onEditor: () => void; onQuick: () => void }) {
  const project = useStore((s) => s.project);
  const [view, setView] = useState<'label' | 'sheet'>('label');
  const pa = project.paper;
  const multi = pa.cols * pa.rows > 1;

  return (
    <div className="small-app">
      <header className="small-bar">
        <strong>LabelLoom</strong>
        <span className="muted ellipsis">{project.name}</span>
        <span className="spacer" />
        <LangSelect />
      </header>
      <div className="small-notice" role="status">
        {t('화면이 작아 편집할 수 없습니다. 지금은 디자인을 보기만 하는 중입니다. 편집은 컴퓨터나 태블릿과 같은 더 큰 디스플레이에서 진행하십시오.')}
      </div>
      <div className="small-tabs">
        {multi ? <Seg value={view} onChange={setView} options={[
          { value: 'label', label: t('라벨 하나씩') },
          { value: 'sheet', label: t('인쇄 모양') },
        ]} /> : <span />}
        <span className="muted small">{pa.labelWidth}×{pa.labelHeight} mm{multi ? ` · ${pa.cols}×${pa.rows}` : ''}</span>
      </div>
      <main className="small-main">{view === 'label' || !multi ? <LabelView /> : <SheetView />}</main>
      <footer className="small-foot">
        <button onClick={onQuick} title={t('값을 입력해 바로 인쇄하는 화면 — 작은 화면에서도 쓸 수 있습니다')}>{t('빠른 출력')}</button>
        <button onClick={() => window.open(docUrl(), '_blank', 'noopener')} title={t('사용법을 웹 문서로 봅니다')}>{t('튜토리얼')} ↗</button>
        <button onClick={() => { if (confirm(t('편집기는 작은 화면에 맞춰져 있지 않아 조작이 어렵습니다. 그래도 여시겠습니까?'))) { forceEditor(); onEditor(); } }}>{t('그래도 편집기 열기')}</button>
      </footer>
    </div>
  );
}
