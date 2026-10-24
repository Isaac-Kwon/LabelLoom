import { useMemo, useRef, useState } from 'react';
import { m, t } from '../i18n';
import { printPages } from '../io/export';
import { copyQuickLink } from '../io/share';
import { newRow } from '../model/defaults';
import type { Project, Row as DataRow } from '../model/types';
import { buildItems, jobFold, labelSizeProject, paginate, projectDuplex, type JobOptions } from '../render/jobs';
import { pickDesign, previewCtx, templateColumns, usedColumns } from '../render/resolve';
import { labelDocument, sheetLayout } from '../render/svg';
import { useStore } from '../store';
import { Check, Modal, Num, PrintSetupAlert, Seg } from './controls';
import { loadExportSettings } from './ExportDialog';

/** Fill in the template's {{fields}}, see the label live, print. Shared by the quick page and the editor dialog. */

const PREFS_KEY = 'labelloom.quick';
const loadPrefs = (): { labelPage?: boolean; cell?: number } => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } };

const DUPLEX_LABEL = { sheets: m('앞뒤 따로 인쇄'), fold: m('펼쳐서 접기') };

interface Entry { id: string; values: Record<string, string>; copies: number }

/** Input fields: columns shown in the design first (in layer order), then columns only used by rules. */
function quickFields(p: Project): string[] {
  const shown: string[] = [];
  for (const d of p.designs) {
    for (const o of [...d.objects, ...(d.back ?? [])]) {
      if ('content' in o) shown.push(...templateColumns(o.content));
      if (o.type === 'table') o.cells.flat().forEach((v) => shown.push(...templateColumns(v)));
    }
  }
  return [...new Set([...shown, ...usedColumns(p)])];
}

/** Autocomplete values: rule values and the template's own sample data. */
function suggestions(p: Project, fields: string[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = Object.fromEntries(fields.map((f) => [f, new Set<string>()]));
  const add = (col: string, v: string) => { if (out[col] && v.trim()) out[col].add(v.trim()); };
  p.designRules.forEach((r) => (r.op === 'eq' || r.op === 'neq') && add(r.column, r.value));
  for (const d of p.designs) for (const o of [...d.objects, ...(d.back ?? [])]) o.rules.forEach((r) => r.column && (r.op === 'eq' || r.op === 'neq') && add(r.column, r.value));
  // sample data only for category-like columns (few values that repeat), not names or IDs
  for (const f of fields) {
    const all = p.data.rows.map((r) => r.values[f]?.trim()).filter(Boolean);
    const vals = new Set(all);
    if (vals.size <= 20 && vals.size < all.length) vals.forEach((v) => add(f, v));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

export function QuickForm({ project, notify, onPrinted }: {
  project: Project;
  notify: (msg: string) => void;
  /** rows that were just printed (with copies) */
  onPrinted?: (rows: DataRow[]) => void;
}) {
  const fields = useMemo(() => quickFields(project), [project]);
  const hints = useMemo(() => suggestions(project, fields), [project, fields]);
  const prefs = useMemo(loadPrefs, []);
  const multi = project.paper.cols * project.paper.rows > 1;
  const [values, setValues] = useState<Record<string, string>>({});
  const [copies, setCopies] = useState(1);
  const [labelPage, setLabelPage] = useState(multi ? prefs.labelPage ?? false : true);
  const [cell, setCell] = useState(prefs.cell ?? 1);
  const [list, setList] = useState<Entry[]>([]);
  const firstInput = useRef<HTMLInputElement>(null);

  const hasBack = project.designs.some((d) => d.back?.length);
  const duplex = useMemo(() => projectDuplex(project, loadExportSettings()), [project]);
  const fold = hasBack ? jobFold({ duplex: true, duplexMode: duplex.mode, foldDir: duplex.foldDir, foldRotate: duplex.foldRotate }) : null;
  const L = sheetLayout(project.paper, fold);
  const perSheet = L.cols * L.rows;
  const useLabelPage = labelPage || !multi;
  const printL = useLabelPage ? sheetLayout(labelSizeProject(project).paper, fold) : L;

  const filled = Object.values(values).some((v) => v.trim());
  // empty form: show the template as designed, with its first sample row
  const previewRow = useMemo<DataRow | undefined>(() => (filled ? { id: 'preview', print: true, copies: 1, values } : project.data.rows[0]), [filled, values, project]);
  const preview = useMemo(() => {
    const d = pickDesign(project, previewRow);
    const ctx = previewCtx(previewRow, 0, project.seqStart);
    return {
      front: labelDocument(project, d.objects, ctx, { white: true }),
      back: d.back?.length ? labelDocument(project, d.back, ctx, { white: true }) : '',
    };
  }, [project, previewRow]);

  const savePrefs = (o: { labelPage?: boolean; cell?: number }) => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ labelPage, cell, ...o })); } catch { /* ignore */ }
  };

  const print = (entries: Entry[]) => {
    const rows = entries.map((e) => ({ ...newRow(e.values), copies: e.copies }));
    const columns = [...new Set([...project.data.columns, ...fields])];
    const base = useLabelPage ? labelSizeProject(project) : project;
    const proj: Project = { ...base, data: { columns, rows } };
    const startCell = useLabelPage ? 1 : Math.min(cell, perSheet);
    const job: JobOptions = {
      scope: 'all', rangeFrom: 1, rangeTo: rows.length, currentRow: 0, copies: 1, blankCount: 1, startCell,
      duplex: hasBack, duplexMode: duplex.mode, mirror: duplex.mirror, foldDir: duplex.foldDir, foldRotate: duplex.foldRotate,
    };
    const items = buildItems(proj, job);
    if (!items.length) { notify(t('인쇄할 라벨이 없습니다.')); return; }
    const pages = paginate(proj, items, { startCell, duplex: hasBack && !fold, fold });
    printPages(proj, pages, { calibrate: !useLabelPage, mirror: duplex.mirror, fold });
    onPrinted?.(rows);
  };

  const current = (): Entry | null => {
    if (fields.length && !filled) { notify(t('값을 입력하세요.')); firstInput.current?.focus(); return null; }
    return { id: Math.random().toString(36).slice(2), values: { ...values }, copies: Math.max(1, Math.round(copies)) };
  };
  const reset = () => { setValues({}); setCopies(1); setTimeout(() => firstInput.current?.focus(), 0); };

  const printNow = () => { const e = current(); if (!e) return; print([e]); reset(); };
  const addToList = () => { const e = current(); if (!e) return; setList((l) => [...l, e]); reset(); };
  const printList = () => { print(list); setList([]); };

  const total = list.reduce((n, e) => n + e.copies, 0);
  const summary = (e: Entry) => fields.map((f) => e.values[f]).filter(Boolean).join(' · ') || t('(빈 라벨)');

  return (
    <div className="quick-form">
      <div className="quick-inputs">
        {fields.length ? fields.map((f, i) => (
          <label key={f} className="quick-field">
            <span>{f}</span>
            <input ref={i === 0 ? firstInput : undefined} autoFocus={i === 0} value={values[f] ?? ''} list={hints[f]?.length ? `qf-${i}` : undefined}
              placeholder={project.data.rows[0]?.values[f] ?? ''}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) printNow(); }} />
            {hints[f]?.length > 0 && <datalist id={`qf-${i}`}>{hints[f].map((v) => <option key={v} value={v} />)}</datalist>}
          </label>
        )) : <p className="muted">{t('이 템플릿에는 입력할 값({{열 이름}})이 없습니다. 매수만 정해 인쇄하세요.')}</p>}

        <div className="quick-opts">
          <Num label={t('매수')} value={copies} step={1} min={1} max={999} onChange={setCopies} width={110} />
          {multi && (
            <Seg value={labelPage ? 'label' : 'sheet'} onChange={(v) => { setLabelPage(v === 'label'); savePrefs({ labelPage: v === 'label' }); }} options={[
              { value: 'label', label: t('라벨 크기 1장'), title: t('라벨 프린터용: 라벨 크기 페이지에 1장씩') },
              { value: 'sheet', label: t('라벨지'), title: t('현재 용지({cols}×{rows})에 배치', { cols: project.paper.cols, rows: project.paper.rows }) },
            ]} />
          )}
          {!useLabelPage && <Num value={Math.min(cell, perSheet)} step={1} min={1} max={perSheet} onChange={(v) => { setCell(v); savePrefs({ cell: v }); }} unit={t('번째 칸부터')} width={140} />}
        </div>

        <div className="quick-actions">
          <button className="primary big" onClick={printNow}>{t('인쇄')}</button>
          <button onClick={addToList}>{t('목록에 추가')}</button>
        </div>
        <PrintSetupAlert width={printL.width} height={printL.height} />

        {list.length > 0 && (
          <div className="quick-list">
            <ol>
              {list.map((e) => (
                <li key={e.id}>
                  <span className="ellipsis">{summary(e)}</span>
                  <span className="muted">×{e.copies}</span>
                  <button className="icon" title={t('빼기')} onClick={() => setList((l) => l.filter((x) => x.id !== e.id))}>✕</button>
                </li>
              ))}
            </ol>
            <div className="quick-actions">
              <button className="primary" onClick={printList}>{t('목록 전체 인쇄 ({n}장)', { n: total })}</button>
              <button onClick={() => setList([])}>{t('비우기')}</button>
            </div>
          </div>
        )}
      </div>

      <div className="quick-preview">
        <div className={`quick-sides ${preview.back ? 'two' : ''}`}>
          <figure><div className="quick-svg" dangerouslySetInnerHTML={{ __html: preview.front }} />{preview.back && <figcaption>{t('앞면')}</figcaption>}</figure>
          {preview.back && <figure><div className="quick-svg" dangerouslySetInnerHTML={{ __html: preview.back }} /><figcaption>{t('뒷면')}</figcaption></figure>}
        </div>
        {!filled && previewRow && <p className="muted small">{t('예시 데이터로 표시 중 — 값을 입력하면 바로 바뀝니다')}</p>}
        {hasBack && (
          <p className="muted small">
            {t('양면')}: {t(DUPLEX_LABEL[duplex.mode])}
            {duplex.mode === 'fold' ? ` (${duplex.foldDir === 'right' ? t('오른쪽') : t('아래')}${duplex.foldRotate ? `, ${t('뒷면 180°')}` : ''})` : ` (${duplex.mirror === 'cols' ? t('긴 쪽 뒤집기') : t('짧은 쪽 뒤집기')})`}
            {!project.duplex && t(' — 템플릿에 저장된 양면 설정이 없어 이 브라우저의 설정을 씁니다')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Editor dialog: same form over the current project, optionally recording what was printed in the data table. */
export function QuickDialog({ onFullscreen }: { onFullscreen: () => void }) {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const [record, setRecord] = useState(true);
  const onPrinted = (rows: DataRow[]) => {
    if (!record) return;
    const now = new Date().toISOString();
    commit((p) => ({ ...p, data: { columns: [...new Set([...p.data.columns, ...rows.flatMap((r) => Object.keys(r.values))])], rows: [...p.data.rows, ...rows.map((r) => ({ ...r, printed: now }))] } }));
  };
  return (
    <Modal title={`${t('빠른 출력')} — ${project.name}`} onClose={close} wide="xl"
      actions={<div className="btn-row">
        <button onClick={async () => notify(await copyQuickLink(project))} title={t('이 템플릿으로 바로 빠른 출력 전체 화면을 여는 링크 (명단은 포함하지 않음)')}>🔗 {t('링크 복사')}</button>
        <button onClick={() => { close(); onFullscreen(); }} title={t('편집기를 닫고 빠른 출력 전용 화면으로 전환합니다 (다시 돌아올 수 있습니다)')}>⛶ {t('전체 화면으로')}</button>
        <button onClick={close} title={t('대화상자를 닫고 디자인 편집으로 돌아갑니다')}>✎ {t('편집기에서 수정')}</button>
      </div>}
      footer={<><Check label={t('입력한 내용을 명단에 기록')} checked={record} onChange={setRecord} /><span className="spacer" /><button onClick={close}>{t('닫기')}</button></>}>
      <QuickForm project={project} notify={notify} onPrinted={onPrinted} />
    </Modal>
  );
}
