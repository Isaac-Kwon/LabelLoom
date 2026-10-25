import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { pickFile } from '../io/project';
import { absorbMeta, fetchTable, findDuplicates, gridToRows, guessKey, isMetaColumn, mergeTable, readTableFile, readTableText, suggestMapping, syncTable, type ImportOptions, type ParsedSheet } from '../io/table';
import type { DataSource, DataTable } from '../model/types';
import { usedColumns } from '../render/resolve';
import { useStore } from '../store';
import { Check, Modal, Num, Row, Seg } from './controls';

const SKIP = '__skip__';
const COPIES = '__copies__';

/** Text pasted into the dialog, read like a file (no link to a source). */
type Pasted = { text: string };
type Source = File | string | Pasted;

/** Seconds between automatic refreshes of a URL source. */
export const INTERVALS = [0, 15, 30, 60, 300];
export const intervalLabel = (s: number) => (!s ? t('끄기') : s < 60 ? t('{n}초마다', { n: s }) : t('{n}분마다', { n: s / 60 }));

export function ImportDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify, setCurrentRow, setSync } = useStore.getState();
  const initial = useStore((s) => s.dialogArg) as File | undefined;
  const [src, setSrc] = useState<Source | null>(null);
  const [url, setUrl] = useState(project.dataSource?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [interval, setRefresh] = useState(project.dataSource?.interval ?? 30);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [trim, setTrim] = useState(true);
  const [mode, setMode] = useState<'replace' | 'append'>(project.data.rows.length ? 'append' : 'replace');
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(false);

  const targets = useMemo(() => [...new Set([...usedColumns(project), ...project.data.columns])], [project]);

  const load = async (f: Source, sheet?: string) => {
    setErr('');
    setBusy(true);
    try {
      const p = typeof f === 'string' ? await fetchTable(f, sheet) : f instanceof File ? await readTableFile(f, sheet) : readTableText(f.text);
      setSrc(f);
      setParsed(p);
      const hr = guessHeaderRow(p.grid);
      setHeaderRow(hr + 1);
      setMapping(suggestMapping(headersOf(p.grid, hr), targets));
    } catch (e) {
      setErr(t('파일을 읽을 수 없습니다: {error}', { error: e instanceof Error ? e.message : String(e) }));
    }
    setBusy(false);
  };
  useEffect(() => { if (initial) void load(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const paste = (text: string) => {
    // a single line without tabs is not a table (most likely a URL or a word)
    if (/[\t\n]/.test(text.trim())) void load({ text });
    else setErr(t('붙여넣은 내용이 표가 아닙니다. 엑셀·스프레드시트에서 범위를 복사하거나, 탭이나 쉼표로 나뉜 여러 줄의 텍스트를 붙여넣으세요.'));
  };
  const pasteRef = useRef(paste);
  pasteRef.current = paste;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // inside a text field (the URL box) the paste goes there as usual
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      pasteRef.current(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  const pasteClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // no Clipboard API (file://, older browsers) or permission denied
      setErr(t('클립보드를 직접 읽을 수 없습니다. 대화상자를 누른 뒤 Ctrl+V(Mac은 ⌘V)로 붙여넣으세요.'));
      return;
    }
    paste(text);
  };

  const headers = parsed ? headersOf(parsed.grid, headerRow - 1) : [];
  const opts = useMemo((): ImportOptions => {
    const m: Record<string, string> = {};
    let copiesColumn: string | undefined;
    for (const h of headers) {
      const t = mapping[h] ?? h;
      if (t === COPIES) copiesColumn = h;
      m[h] = t === SKIP ? '' : t;
    }
    return { headerRow: headerRow - 1, trim, mapping: m, copiesColumn };
  }, [headers.join('\u0001'), mapping, trim, headerRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => (parsed ? gridToRows(parsed.grid, opts) : null), [parsed, opts]);
  const fromUrl = typeof src === 'string';
  // pasting the same list again into it updates the rows that share a key instead of repeating them
  const syncPaste = !!src && typeof src === 'object' && !(src instanceof File) && mode === 'append';
  const keyCol = resolved ? (key !== null && (key === '' || resolved.columns.includes(key)) ? key : guessKey(resolved.columns)) : '';

  const missing = resolved ? usedColumns(project).filter((c) => !resolved.columns.includes(c) && !(mode === 'append' && project.data.columns.includes(c))) : [];
  const empties = resolved ? usedColumns(project).filter((c) => resolved.columns.includes(c)).map((c) => ({ c, n: resolved.rows.filter((r) => !(r.values[c] ?? '').trim()).length })).filter((x) => x.n > 0) : [];
  const dupKeys = resolved ? [t('이름'), t('소속'), t('이메일'), 'ID'].filter((c) => resolved.columns.includes(c)).slice(0, 2) : [];
  const dupCount = resolved && dupKeys.length ? findDuplicates(resolved.rows, dupKeys).size : 0;

  const apply = () => {
    if (!resolved) return;
    const rows = absorbMeta(resolved.rows);
    const cols = resolved.columns.filter((c) => !isMetaColumn(c));
    const source: DataSource | undefined = typeof src === 'string' && parsed ? { url: src, sheet: parsed.sheet, ...opts, key: keyCol, interval } : undefined;
    const add = { columns: cols, rows };
    const sync = syncPaste && keyCol;
    let added = 0, updated = 0;
    // a file or pasted text that replaces the table ends the link to a URL; appended to it, the link stays
    commit((p) => {
      let data: DataTable;
      if (sync) ({ table: data, added, updated } = syncTable(p.data, add, keyCol, !!opts.copiesColumn));
      else data = mergeTable(p.data, add, mode);
      return { ...p, data, dataSource: source ?? (mode === 'replace' ? undefined : p.dataSource) };
    });
    if (source) setSync({ at: new Date().toISOString(), error: undefined });
    if (mode === 'replace') setCurrentRow(0);
    notify(sync ? t('{added}행을 추가하고 {updated}행을 갱신했습니다.', { added, updated }) : t('{n}행을 가져왔습니다.', { n: rows.length }));
    close();
  };

  return (
    <Modal title={t('데이터 가져오기 (xlsx · xls · csv · URL · 붙여넣기)')} onClose={close} wide="xl" footer={
      <>
        {resolved && <span className="muted">{t('{rows}행 · {cols}열', { rows: resolved.rows.length, cols: resolved.columns.length })}</span>}
        <span className="spacer" />
        <button onClick={close}>{t('취소')}</button>
        <button className="primary" disabled={!resolved || !resolved.rows.length} onClick={apply}>{mode === 'replace' ? t('바꾸기') : t('추가')}</button>
      </>
    }>
      <div className={`drop ${hover ? 'hover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setHover(true); }} onDragLeave={() => setHover(false)}
        onDrop={(e) => { e.preventDefault(); setHover(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
        <button onClick={async () => { const f = await pickFile('.xlsx,.xls,.xlsm,.csv,.tsv,.txt,.ods'); if (f) void load(f); }}>{t('파일 선택…')}</button>
        <button onClick={() => void pasteClipboard()}>{t('클립보드에서 붙여넣기')}</button>
        <span className="muted">{src instanceof File ? src.name : src && typeof src === 'object' ? t('붙여넣은 텍스트 ({n}행)', { n: resolved?.rows.length ?? 0 }) : t('또는 파일을 여기로 끌어오거나, 엑셀·스프레드시트에서 복사한 범위를 Ctrl+V로 붙여넣으세요. 첫 행은 열 이름이어야 합니다.')}</span>
      </div>
      <div className="url-row">
        <input type="url" placeholder={t('또는 URL (CSV · xlsx · Google 스프레드시트 링크)')} value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) void load(url.trim()); }} />
        <button disabled={!url.trim() || busy} onClick={() => void load(url.trim())}>{busy ? t('불러오는 중…') : t('URL에서 불러오기')}</button>
      </div>
      <div className="warn">{t('URL 불러오기는 실험적 기능입니다. 서버나 네트워크 환경에 따라 동작하지 않을 수 있습니다.')}</div>
      <p className="muted small">{t('서버의 CSV를 주기적으로 다시 받아 새 행을 추가할 수 있습니다 (예: 현장 등록 폼 응답). Google 스프레드시트는 "링크가 있는 모든 사용자"에게 공유한 뒤 주소를 붙여 넣으세요. 다른 서버는 CORS를 허용해야 합니다.')}</p>
      {err && <div className="warn">{err}</div>}
      {parsed && (
        <>
          <div className="import-opts">
            {parsed.sheetNames.length > 1 && (
              <Row label={t('시트')}>
                <select value={parsed.sheet} onChange={(e) => src && load(src, e.target.value)}>{parsed.sheetNames.map((n) => <option key={n}>{n}</option>)}</select>
              </Row>
            )}
            <Row label={t('열 이름 행')}><Num value={headerRow} step={1} min={1} max={Math.max(1, parsed.grid.length)} onChange={(v) => { setHeaderRow(v); setMapping(suggestMapping(headersOf(parsed.grid, v - 1), targets)); }} /></Row>
            <Row label={t('방식')}><Seg value={mode} onChange={setMode} options={[{ value: 'replace', label: t('기존 데이터 바꾸기') }, { value: 'append', label: t('뒤에 추가') }]} /></Row>
            <Check label={t('앞뒤 공백·중복 공백 정리')} checked={trim} onChange={setTrim} />
            {(fromUrl || syncPaste) && resolved && (
              <>
                {fromUrl && (
                  <Row label={t('자동 새로고침')}>
                    <select value={interval} onChange={(e) => setRefresh(Number(e.target.value))}>{INTERVALS.map((s) => <option key={s} value={s}>{intervalLabel(s)}</option>)}</select>
                  </Row>
                )}
                <Row label={t('키 열')}>
                  <select value={keyCol} onChange={(e) => setKey(e.target.value)}>
                    <option value="">{fromUrl ? t('(행 전체 비교)') : t('(키 없음)')}</option>
                    {resolved.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Row>
                <div className="note">{fromUrl
                  ? t('새로고침하면 키 열 값이 같은 행은 서버의 값으로 바꾸고 (인쇄 체크·출력 기록은 유지), 새 행은 뒤에 추가합니다. 서버에서 사라진 행은 지우지 않습니다. 등록번호·이메일처럼 겹치지 않는 열을 고르세요.')
                  : keyCol
                    ? t('키 열 값이 이미 있는 행은 새 값으로 바꾸고 (인쇄 체크·출력 기록은 유지), 새 행만 뒤에 추가합니다. 같은 명단을 다시 붙여넣어도 행이 겹치지 않습니다.')
                    : t('키 열이 없으면 모든 행을 뒤에 추가합니다.')}</div>
              </>
            )}
          </div>
          {parsed.merged > 0 && <div className="warn">⚠ {t('병합된 셀 {n}개가 있습니다. 병합 셀은 첫 칸에만 값이 들어갑니다. 원본에서 병합을 풀고 다시 시도하는 것이 좋습니다.', { n: parsed.merged })}</div>}
          <h3>{t('열 매핑')}</h3>
          <p className="muted small">{t('디자인에서 쓰는 열 이름으로 자동 연결했습니다 (이름·성명·Name, 소속·Affiliation 등). 필요하면 바꾸세요.')}</p>
          <div className="mapping">
            {headers.map((h) => {
              const v = mapping[h] ?? h;
              return (
                <div key={h} className="map-row">
                  <span className="src" title={h}>{h}</span>
                  <span>→</span>
                  <select value={v} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                    <option value={h}>{h} {t('(그대로)')}</option>
                    {targets.filter((x) => x !== h).map((x) => <option key={x} value={x}>{x}</option>)}
                    <option value={COPIES}>{t('[매수 열로 사용]')}</option>
                    <option value={SKIP}>{t('[가져오지 않음]')}</option>
                  </select>
                  {targets.includes(v) && <span className="ok small">✓ {t('디자인 연결')}</span>}
                </div>
              );
            })}
          </div>
          {missing.length > 0 && <div className="warn">{t('디자인에서 쓰는 열이 데이터에 없습니다: {cols}', { cols: missing.join(', ') })}</div>}
          {empties.length > 0 && <div className="note">{t('빈 값: {list}', { list: empties.map((x) => `${x.c} ${t('{n}행', { n: x.n })}`).join(', ') })}</div>}
          {dupCount > 0 && <div className="note">{t('중복 의심 {n}행 ({keys} 기준) — 가져온 뒤 데이터 패널 "더보기 › 중복 검사"로 표시할 수 있습니다.', { n: dupCount, keys: dupKeys.join('+') })}</div>}
          <h3>{t('미리보기')}</h3>
          <div className="table-preview">
            <table>
              <thead><tr>{resolved?.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{resolved?.rows.slice(0, 8).map((r) => <tr key={r.id}>{resolved.columns.map((c) => <td key={c}>{r.values[c]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function headersOf(grid: string[][], row: number) {
  return (grid[row] ?? []).map((h, i) => h.trim() || t('열{n}', { n: i + 1 }));
}

/** First row whose filled cells look like a header (several non-numeric labels). */
function guessHeaderRow(grid: string[][]): number {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const filled = grid[i].filter((c) => c.trim());
    if (filled.length >= Math.min(2, Math.max(...grid.slice(0, 10).map((r) => r.filter((c) => c.trim()).length))) && filled.every((c) => isNaN(Number(c)))) return i;
  }
  return 0;
}
