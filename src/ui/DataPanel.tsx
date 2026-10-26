import { useEffect, useMemo, useRef, useState } from 'react';
import { locale, getLang, t, tn } from '../i18n';
import { refreshSource } from '../io/remote';
import { exportTable, findDuplicates } from '../io/table';
import { newRow } from '../model/defaults';
import type { Project, Row } from '../model/types';
import { pickDesign, renameColumnInDesigns } from '../render/resolve';
import { useStore } from '../store';
import { INTERVALS, intervalLabel } from './ImportDialog';
import { missingColumns } from './ReplaceDialogs';

const ROW_H = 26;

export function filterRows(p: Project, f: { text: string; column: string; value: string }): Set<string> {
  const t = f.text.trim().toLowerCase();
  const ids = new Set<string>();
  for (const r of p.data.rows) {
    if (f.column && f.value !== '' && (r.values[f.column] ?? '').trim() !== f.value) continue;
    if (t && !Object.values(r.values).some((v) => v.toLowerCase().includes(t))) continue;
    ids.add(r.id);
  }
  return ids;
}

export function DataPanel({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const project = useStore((s) => s.project);
  const currentRow = useStore((s) => s.currentRow);
  const filter = useStore((s) => s.filter);
  const sync = useStore((s) => s.sync);
  const source = project.dataSource;
  const { commit, setCurrentRow, setFilter, open } = useStore.getState();
  const { columns, rows } = project.data;
  const [scroll, setScroll] = useState(0);
  const [dupKeys, setDupKeys] = useState<string[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const body = useRef<HTMLDivElement>(null);

  const visibleIds = useMemo(() => filterRows(project, filter), [project, filter]);
  const filtered = filter.text || (filter.column && filter.value !== '');
  const view = useMemo(() => rows.map((r, i) => ({ r, i })).filter((x) => !filtered || visibleIds.has(x.r.id)), [rows, visibleIds, filtered]);
  const dups = useMemo(() => (dupKeys ? findDuplicates(rows, dupKeys) : new Set<string>()), [rows, dupKeys]);
  const multiDesign = project.designs.length > 1;
  const printedCount = rows.filter((r) => r.printed).length;
  const checkedCount = rows.filter((r) => r.checkedIn).length;
  const missing = useMemo(() => missingColumns(project), [project]);
  const totalLabels = rows.filter((r) => r.print).reduce((s, r) => s + r.copies, 0);

  const setTable = (fn: (rows: Row[], cols: string[]) => { rows?: Row[]; columns?: string[] }) =>
    commit((p) => { const res = fn(p.data.rows, p.data.columns); return { ...p, data: { columns: res.columns ?? p.data.columns, rows: res.rows ?? p.data.rows } }; });
  const setCell = (id: string, col: string, v: string) =>
    setTable((rs) => ({ rows: rs.map((r) => (r.id === id ? { ...r, values: { ...r.values, [col]: v } } : r)) }));
  const setRow = (id: string, patch: Partial<Row>) => setTable((rs) => ({ rows: rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const addColumn = () => {
    const name = prompt(t('새 열 이름'));
    if (!name || columns.includes(name)) return;
    setTable(() => ({ columns: [...columns, name] }));
  };
  const renameColumn = (c: string) => {
    const name = prompt(t('열 이름 변경 (디자인의 {{열 이름}}도 함께 바뀝니다)'), c);
    if (!name || name === c || columns.includes(name)) return;
    commit((p) => {
      const q = renameColumnInDesigns(p, c, name);
      return {
        ...q,
        data: {
          columns: p.data.columns.map((x) => (x === c ? name : x)),
          rows: p.data.rows.map((r) => { const { [c]: v, ...rest } = r.values; return { ...r, values: { ...rest, [name]: v ?? '' } }; }),
        },
      };
    });
  };
  const deleteColumn = (c: string) => {
    if (!confirm(t('"{name}" 열을 삭제할까요?', { name: c }))) return;
    setTable((rs, cols) => ({ columns: cols.filter((x) => x !== c), rows: rs.map((r) => { const { [c]: _, ...rest } = r.values; void _; return { ...r, values: rest }; }) }));
  };
  const sortBy = (c: string, dir: 1 | -1) => {
    const coll = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' });
    setTable((rs) => ({ rows: [...rs].sort((a, b) => coll.compare(a.values[c] ?? '', b.values[c] ?? '') * dir) }));
  };
  const addRow = () => {
    setTable((rs) => ({ rows: [...rs, newRow()] }));
    setCurrentRow(rows.length);
    setTimeout(() => body.current?.scrollTo({ top: 1e9 }), 0);
  };
  // with no rows picked, the button removes the current row
  const curRow = rows[currentRow];
  // the first click arms the button (red), the second deletes
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [sel, currentRow]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  const removeRows = (ids: Set<string>) => {
    // the row that slides into the first deleted spot becomes current; past the end, the new last row
    const first = rows.findIndex((r) => ids.has(r.id));
    const left = rows.filter((r) => !ids.has(r.id)).length;
    setTable((rs) => ({ rows: rs.filter((r) => !ids.has(r.id)) }));
    setCurrentRow(Math.max(0, Math.min(first, left - 1)));
    setSel(new Set());
    setArmed(false);
  };
  const deleteRows = () => {
    const ids = sel.size ? sel : new Set(curRow ? [curRow.id] : []);
    if (!ids.size) return;
    if (!armed) { setArmed(true); return; }
    removeRows(ids);
  };
  // every row, or only the rows the filter shows; the columns stay
  const deleteAll = () => {
    if (!view.length) return;
    let msg = filtered
      ? t('필터 결과 {n}행을 삭제할까요? 열은 그대로 남고, 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.', { n: view.length })
      : t('모든 행({n}행)을 삭제할까요? 열은 그대로 남고, 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.', { n: view.length });
    if (source) msg += '\n' + t('URL 연결은 남아 있으므로 다음 새로고침 때 서버의 행이 다시 들어옵니다.');
    if (confirm(msg)) removeRows(new Set(view.map((x) => x.r.id)));
  };
  const pickRow = (e: React.MouseEvent, id: string) => {
    const add = e.ctrlKey || e.metaKey;
    const at = view.findIndex((x) => x.r.id === id);
    // a Shift+click range starts at the current row (a plain click on a row moves it there)
    const from = view.findIndex((x) => x.r.id === rows[currentRow]?.id);
    if (e.shiftKey && from >= 0) {
      const [a, b] = from < at ? [from, at] : [at, from];
      setSel(new Set([...(add ? sel : []), ...view.slice(a, b + 1).map((x) => x.r.id)]));
      return;
    }
    const n = new Set(add ? sel : []);
    if (sel.has(id) && (add || sel.size === 1)) n.delete(id); else n.add(id);
    setSel(n);
  };
  const allPicked = view.length > 0 && view.every((x) => sel.has(x.r.id));
  const checkAll = (v: boolean) => {
    const ids = new Set(view.map((x) => x.r.id));
    setTable((rs) => ({ rows: rs.map((r) => (ids.has(r.id) ? { ...r, print: v } : r)) }));
  };
  const clearPrinted = () => {
    if (!confirm(t('모든 행의 인쇄 기록을 지울까요?'))) return;
    setTable((rs) => ({ rows: rs.map((r) => ({ ...r, printed: undefined })) }));
  };
  const clearCheckIn = () => {
    if (!confirm(t('모든 행의 체크인 기록을 지울까요?'))) return;
    setTable((rs) => ({ rows: rs.map((r) => ({ ...r, checkedIn: undefined })) }));
  };

  const start = Math.max(0, Math.floor(scroll / ROW_H) - 5);
  const end = Math.min(view.length, start + Math.ceil((height - 60) / ROW_H) + 12);

  const startDrag = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => onResize(Math.max(90, Math.min(window.innerHeight - 200, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const colW = 'minmax(110px, 1fr)';
  const template = `56px 34px 52px ${multiDesign ? '96px ' : ''}64px ${columns.map(() => colW).join(' ')} 34px`;

  return (
    <section className="data-panel" data-tour="data" style={{ height }}>
      <div className="resize-handle" onPointerDown={startDrag} />
      <div className="data-toolbar">
        <strong>{t('데이터')}</strong>
        <span className="muted small">{t('{rows}행 · 인쇄 {labels}장 · 출력됨 {printed}', { rows: rows.length, labels: totalLabels, printed: printedCount })}{checkedCount ? ` · ${t('체크인 {n}', { n: checkedCount })}` : ''}</span>
        <button data-tour="import" onClick={() => open('import')}>{t('가져오기 (xlsx·csv)')}</button>
        {source && (
          <span className="sync-status" title={source.url}>
            <button onClick={() => void refreshSource(true)} disabled={sync.busy}>⟳ {t('URL 새로고침')}</button>
            <select value={source.interval} title={t('자동 새로고침')}
              onChange={(e) => commit((p) => (p.dataSource ? { ...p, dataSource: { ...p.dataSource, interval: Number(e.target.value) } } : p))}>
              {INTERVALS.map((s) => <option key={s} value={s}>{intervalLabel(s)}</option>)}
            </select>
            {sync.error
              ? <span className="sync-err small" title={sync.error}>⚠ {t('새로고침 실패')}</span>
              : sync.at && <span className="muted small">{new Date(sync.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </span>
        )}
        <div className="dropdown">
          <button>{t('내보내기')} ▾</button>
          <div className="menu">
            <button onClick={() => exportTable(project.data, 'xlsx', project.name)}>{t('xlsx (인쇄 기록 포함)')}</button>
            <button onClick={() => exportTable(project.data, 'csv', project.name)}>{t('csv (인쇄 기록 포함)')}</button>
            <button onClick={() => exportTable(project.data, 'xlsx', project.name, false)}>{t('xlsx (데이터만)')}</button>
          </div>
        </div>
        {missing.length > 0 && (
          <button className="warn-btn" onClick={() => open('remap')} title={missing.map((c) => `{{${c}}}`).join(' ')}>⚠ {t('디자인의 열 {n}개가 데이터에 없음 · 다시 연결', { n: missing.length })}</button>
        )}
        <button data-tour="serial" onClick={() => open('serial')}>{t('일련번호 생성')}</button>
        <button onClick={addRow}>＋ {t('행')}</button>
        <button onClick={addColumn}>＋ {t('열')}</button>
        <button className={armed ? 'danger' : ''} onClick={deleteRows} onBlur={() => setArmed(false)} disabled={!sel.size && !curRow}
          title={sel.size ? undefined : t('행 번호 클릭: 행 선택 · Shift+클릭: 범위 선택 · Ctrl+클릭: 추가/빼기 · # 클릭: 모두 선택')}>
          {armed ? t('한 번 더 눌러 삭제') : t('행 삭제')}{sel.size ? ` (${sel.size})` : armed ? ` (${t('{n}행', { n: currentRow + 1 })})` : ''}
        </button>
        {sel.size > 0 && <button onClick={() => setSel(new Set())}>{t('선택 해제')}</button>}
        <span className="spacer" />
        <input className="search" type="search" placeholder={t('검색…')} value={filter.text} onChange={(e) => setFilter({ text: e.target.value })} />
        <select value={filter.column} onChange={(e) => setFilter({ column: e.target.value, value: '' })} title={t('열 값으로 거르기')}>
          <option value="">{t('필터 열')}</option>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {filter.column && (
          <select value={filter.value} onChange={(e) => setFilter({ value: e.target.value })}>
            <option value="">{t('(전체)')}</option>
            {[...new Set(rows.map((r) => (r.values[filter.column] ?? '').trim()))].sort().map((v) => <option key={v} value={v}>{v || t('(빈 값)')}</option>)}
          </select>
        )}
        <div className="dropdown">
          <button>{t('더보기')} ▾</button>
          <div className="menu">
            <button onClick={() => checkAll(true)}>{filtered ? t('필터 결과 인쇄 체크') : t('모든 행 인쇄 체크')}</button>
            <button onClick={() => checkAll(false)}>{filtered ? t('필터 결과 인쇄 해제') : t('모든 행 인쇄 해제')}</button>
            <button onClick={() => {
              const k = prompt(t('중복을 검사할 열 (쉼표로 구분)'), columns.filter((c) => /이름|name|nome|nom|이메일|e-?mail|courriel/i.test(c)).join(', ') || columns[0]);
              if (k === null) return;
              const keys = k.split(',').map((x) => x.trim()).filter((x) => columns.includes(x));
              setDupKeys(keys.length ? keys : null);
              if (keys.length) useStore.getState().notify(t('중복 {n}행 표시', { n: findDuplicates(rows, keys).size }));
            }}>{t('중복 검사…')}</button>
            {dupKeys && <button onClick={() => setDupKeys(null)}>{t('중복 표시 끄기')}</button>}
            <button onClick={clearPrinted}>{t('인쇄 기록 지우기')}</button>
            {checkedCount > 0 && <button onClick={clearCheckIn}>{t('체크인 기록 지우기')}</button>}
            {source && <button onClick={() => { if (confirm(t('URL 연결을 끊을까요? 지금 데이터는 그대로 남습니다.'))) commit((p) => ({ ...p, dataSource: undefined })); }}>{t('URL 연결 끊기')}</button>}
            <button onClick={() => open('reprint')}>{t('현장 재발행 / 현장 등록')}</button>
            <button onClick={() => open('replace')}>{t('찾아 바꾸기…')}</button>
            <button onClick={() => open('remap')}>{t('열 다시 연결…')}</button>
            <button onClick={deleteAll} disabled={!view.length}>{filtered ? t('필터 결과 {n}행 삭제…', { n: view.length }) : t('모든 행 삭제…')}</button>
          </div>
        </div>
      </div>
      <div className="grid" ref={body} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
        {!columns.length && !rows.length ? (
          <div className="grid-empty">
            <p>{tn('데이터가 없습니다. xlsx/csv 파일을 {import} 하거나 {serial}, {column}로 시작하세요.', { import: <b>{t('가져오기')}</b>, serial: <b>{t('일련번호 생성')}</b>, column: <b>＋ {t('열')}</b> })}</p>
            <p className="muted small">{t('첫 행은 열 이름이어야 하며 병합된 셀은 사용할 수 없습니다. 데이터가 없으면 디자인 그대로 출력됩니다.')}</p>
          </div>
        ) : (
          <div className="grid-inner" style={{ minWidth: 300 + columns.length * 110 }}>
            <div className="grid-head" style={{ gridTemplateColumns: template }}>
              <span className="idx idx-head" title={`${allPicked ? t('선택 해제') : filtered ? t('필터 결과 모두 선택') : t('모든 행 선택')}\n${t('행 번호 클릭: 행 선택 · Shift+클릭: 범위 선택 · Ctrl+클릭: 추가/빼기 · # 클릭: 모두 선택')}`}
                onClick={() => setSel(allPicked ? new Set() : new Set(view.map((x) => x.r.id)))}>#<small>{t('행 선택')}</small></span>
              <span title={t('인쇄 여부')}><input type="checkbox" checked={view.length > 0 && view.every((x) => x.r.print)} onChange={(e) => checkAll(e.target.checked)} /></span>
              <span>{t('매수')}</span>
              {multiDesign && <span>{t('디자인')}</span>}
              <span>{t('출력')}</span>
              {columns.map((c) => (
                <span key={c} className="col-head">
                  <span className="col-name" onDoubleClick={() => renameColumn(c)} title={t('더블클릭: 이름 변경')}>{c}</span>
                  <span className="col-tools">
                    <button className="icon tiny" title={t('오름차순 정렬')} onClick={() => sortBy(c, 1)}>↑</button>
                    <button className="icon tiny" title={t('내림차순 정렬')} onClick={() => sortBy(c, -1)}>↓</button>
                    <button className="icon tiny" title={t('열 삭제')} onClick={() => deleteColumn(c)}>✕</button>
                  </span>
                </span>
              ))}
              <span />
            </div>
            <div style={{ height: view.length * ROW_H, position: 'relative' }}>
              {view.slice(start, end).map(({ r, i }, k) => (
                <div key={r.id} className={`grid-row ${i === currentRow ? 'cur' : ''} ${sel.has(r.id) ? 'sel' : ''} ${dups.has(r.id) ? 'dup' : ''} ${r.print ? '' : 'off'}`}
                  style={{ gridTemplateColumns: template, top: (start + k) * ROW_H, height: ROW_H }}
                  onMouseDown={() => setCurrentRow(i)}>
                  <span className="idx" onClick={(e) => pickRow(e, r.id)} onMouseDown={(e) => { if (e.shiftKey) e.stopPropagation(); /* keep the range start */ }}
                    title={t('행 번호 클릭: 행 선택 · Shift+클릭: 범위 선택 · Ctrl+클릭: 추가/빼기 · # 클릭: 모두 선택')}>{i + 1}</span>
                  <span><input type="checkbox" checked={r.print} onChange={(e) => setRow(r.id, { print: e.target.checked })} /></span>
                  <span><input className="copies" type="number" min={0} value={r.copies} onChange={(e) => setRow(r.id, { copies: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></span>
                  {multiDesign && <span className="muted small ellipsis">{pickDesign(project, r).name}</span>}
                  <span className={`status ${r.printed ? 'done' : ''}`} title={(r.printed ? new Date(r.printed).toLocaleString(locale()) : t('미출력')) + (r.checkedIn ? `
${t('체크인 {time}', { time: new Date(r.checkedIn).toLocaleString(locale()) })}` : '')}
                    onClick={() => setRow(r.id, { printed: r.printed ? undefined : new Date().toISOString() })}>{r.printed ? '✓ ' + new Date(r.printed).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  {columns.map((c) => (
                    <input key={c + (r.values[c] ?? '')} className="cell" defaultValue={r.values[c] ?? ''}
                      onBlur={(e) => { if (e.target.value !== (r.values[c] ?? '')) setCell(r.id, c, e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  ))}
                  <span />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
