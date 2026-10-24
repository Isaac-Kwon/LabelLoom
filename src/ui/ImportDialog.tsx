import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { pickFile } from '../io/project';
import { absorbMeta, findDuplicates, gridToRows, isMetaColumn, mergeTable, readTableFile, suggestMapping, type ParsedSheet } from '../io/table';
import { usedColumns } from '../render/resolve';
import { useStore } from '../store';
import { Check, Modal, Num, Row, Seg } from './controls';

const SKIP = '__skip__';
const COPIES = '__copies__';

export function ImportDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify, setCurrentRow } = useStore.getState();
  const initial = useStore((s) => s.dialogArg) as File | undefined;
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [trim, setTrim] = useState(true);
  const [mode, setMode] = useState<'replace' | 'append'>(project.data.rows.length ? 'append' : 'replace');
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(false);

  const targets = useMemo(() => [...new Set([...usedColumns(project), ...project.data.columns])], [project]);

  const load = async (f: File, sheet?: string) => {
    setErr('');
    try {
      const p = await readTableFile(f, sheet);
      setFile(f);
      setParsed(p);
      const hr = guessHeaderRow(p.grid);
      setHeaderRow(hr + 1);
      setMapping(suggestMapping(headersOf(p.grid, hr), targets));
    } catch (e) {
      setErr(t('파일을 읽을 수 없습니다: {error}', { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  useEffect(() => { if (initial) void load(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const headers = parsed ? headersOf(parsed.grid, headerRow - 1) : [];
  const resolved = useMemo(() => {
    if (!parsed) return null;
    const m: Record<string, string> = {};
    let copiesColumn: string | undefined;
    for (const h of headers) {
      const t = mapping[h] ?? h;
      if (t === COPIES) copiesColumn = h;
      m[h] = t === SKIP ? '' : t;
    }
    return gridToRows(parsed.grid, { headerRow: headerRow - 1, trim, mapping: m, copiesColumn });
  }, [parsed, headers.join('\u0001'), mapping, trim, headerRow]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = resolved ? usedColumns(project).filter((c) => !resolved.columns.includes(c) && !(mode === 'append' && project.data.columns.includes(c))) : [];
  const empties = resolved ? usedColumns(project).filter((c) => resolved.columns.includes(c)).map((c) => ({ c, n: resolved.rows.filter((r) => !(r.values[c] ?? '').trim()).length })).filter((x) => x.n > 0) : [];
  const dupKeys = resolved ? [t('이름'), t('소속'), t('이메일'), 'ID'].filter((c) => resolved.columns.includes(c)).slice(0, 2) : [];
  const dupCount = resolved && dupKeys.length ? findDuplicates(resolved.rows, dupKeys).size : 0;

  const apply = () => {
    if (!resolved) return;
    const rows = absorbMeta(resolved.rows);
    const cols = resolved.columns.filter((c) => !isMetaColumn(c));
    commit((p) => ({ ...p, data: mergeTable(p.data, { columns: cols, rows }, mode) }));
    if (mode === 'replace') setCurrentRow(0);
    notify(t('{n}행을 가져왔습니다.', { n: rows.length }));
    close();
  };

  return (
    <Modal title={t('데이터 가져오기 (xlsx · xls · csv)')} onClose={close} wide="xl" footer={
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
        <span className="muted">{file ? file.name : t('또는 파일을 여기로 끌어오세요. 첫 행은 열 이름이어야 합니다.')}</span>
      </div>
      {err && <div className="warn">{err}</div>}
      {parsed && (
        <>
          <div className="import-opts">
            {parsed.sheetNames.length > 1 && (
              <Row label={t('시트')}>
                <select value={parsed.sheet} onChange={(e) => file && load(file, e.target.value)}>{parsed.sheetNames.map((n) => <option key={n}>{n}</option>)}</select>
              </Row>
            )}
            <Row label={t('열 이름 행')}><Num value={headerRow} step={1} min={1} max={Math.max(1, parsed.grid.length)} onChange={(v) => { setHeaderRow(v); setMapping(suggestMapping(headersOf(parsed.grid, v - 1), targets)); }} /></Row>
            <Row label={t('방식')}><Seg value={mode} onChange={setMode} options={[{ value: 'replace', label: t('기존 데이터 바꾸기') }, { value: 'append', label: t('뒤에 추가') }]} /></Row>
            <Check label={t('앞뒤 공백·중복 공백 정리')} checked={trim} onChange={setTrim} />
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
