import { useMemo, useState } from 'react';
import { download, exportPdf, exportPngZip, exportSplitPdfZip, printPages, printTestPage, safeName } from '../io/export';
import { barcodeSvg, code2dSvg } from '../render/barcode';
import { buildItems, DEFAULT_DUPLEX, jobFold, paginate, projectDuplex, selectRows, type JobOptions, type Scope } from '../render/jobs';
import { resolveObject } from '../render/resolve';
import { sheetDocument, sheetLayout } from '../render/svg';
import type { Project } from '../model/types';
import { useStore } from '../store';
import { Check, Modal, Num, Progress, Row, Select, Seg } from './controls';
import { filterRows } from './DataPanel';

type Format = 'print' | 'pdf' | 'png' | 'split';

const SETTINGS_KEY = 'labelloom.exportSettings';
export const loadExportSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } };

/** Initial duplex options: the project's saved layout (duplex on), else the browser's last settings. */
function duplexJob(p: Project, saved: Record<string, unknown>, hasBack: boolean) {
  const d = projectDuplex(p, saved);
  return { ...DEFAULT_DUPLEX, duplex: hasBack && !!p.duplex, duplexMode: d.mode, mirror: d.mirror, foldDir: d.foldDir, foldRotate: d.foldRotate };
}

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const currentRow = useStore((s) => s.currentRow);
  const filter = useStore((s) => s.filter);
  const { close, commit, notify } = useStore.getState();
  const arg = useStore((s) => s.dialogArg) as Partial<JobOptions> | undefined;
  const saved = useMemo(loadExportSettings, []);
  const hasRows = project.data.rows.length > 0;
  const hasBack = project.designs.some((d) => d.back?.length);
  const filtered = !!(filter.text || (filter.column && filter.value !== ''));

  const [format, setFormat] = useState<Format>(saved.format ?? 'print');
  const [job, setJob] = useState<JobOptions>({
    scope: arg?.scope ?? (filtered ? 'filtered' : 'checked'), rangeFrom: 1, rangeTo: project.data.rows.length || 1,
    currentRow, copies: 1, blankCount: project.paper.cols * project.paper.rows, startCell: 1,
    ...duplexJob(project, saved, hasBack), ...arg,
  });
  const [cropMarks, setCropMarks] = useState<boolean>(saved.cropMarks ?? false);
  const [outlines, setOutlines] = useState<boolean>(false);
  const [calibrate, setCalibrate] = useState<boolean>(saved.calibrate ?? true);
  const [pdfMode, setPdfMode] = useState<'vector' | 'raster'>(saved.pdfMode ?? 'vector');
  const [dpi, setDpi] = useState<number>(saved.dpi ?? project.paper.dpi);
  const [nameTpl, setNameTpl] = useState<string>(saved.nameTpl ?? '{{#seq:0000}}');
  const [white, setWhite] = useState<boolean>(saved.white ?? true);
  const [splitCol, setSplitCol] = useState<string>(project.data.columns.find((c) => /구분|type|category/i.test(c)) ?? project.data.columns[0] ?? '');
  const [markPrinted, setMarkPrinted] = useState<boolean>(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);

  const filteredIds = useMemo(() => filterRows(project, filter), [project, filter]);
  const opts: JobOptions = { ...job, filteredIds, currentRow };
  const items = useMemo(() => buildItems(project, opts), [project, job, filteredIds, currentRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const fold = hasBack && format !== 'png' ? jobFold(job) : null;
  const layout = sheetLayout(project.paper, fold);
  const pages = useMemo(
    () => paginate(project, items, { startCell: format === 'png' ? 1 : job.startCell, duplex: job.duplex && hasBack && !fold, fold }),
    [project, items, job.startCell, job.duplex, hasBack, format, fold?.dir, fold?.rotate], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sheetCount = pages.filter((p) => !p.back).length;
  const per = layout.cols * layout.rows;
  const pa = project.paper;
  const bleedClipped = pa.bleed > 0 && !fold && ((pa.cols > 1 && pa.gapX < 2 * pa.bleed) || (pa.rows > 1 && pa.gapY < 2 * pa.bleed));

  const errors = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const key = it.row?.id ?? String(it.rowIndex);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const o of it.design.objects) {
        if (o.type !== 'barcode' && o.type !== 'qr') continue;
        const r = resolveObject(o, { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: 1, page: 1, now: new Date() });
        if (r.hidden) continue;
        const res = o.type === 'barcode' ? barcodeSvg(o, r.content) : code2dSvg(o, r.content);
        if ('error' in res) out.push(`${it.rowIndex + 1}행 ${o.name}: ${res.error}`);
      }
      if (out.length > 50) break;
    }
    return out;
  }, [items]);

  const sheetOpts = { cropMarks, outlines, calibrate, mirror: job.mirror, fold };
  const previewSvg = useMemo(() => {
    const pg = pages[Math.min(page, pages.length - 1)];
    return pg ? sheetDocument(project, pg.cells, { ...sheetOpts, outlines: true, calibrate: false, mirror: pg.back ? job.mirror : 'none' }, 999) : '';
  }, [pages, page, project, cropMarks, job.mirror, fold?.dir, fold?.rotate]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        format, cropMarks, calibrate, pdfMode, dpi, nameTpl, white,
        duplexMode: job.duplexMode, foldDir: job.foldDir, foldRotate: job.foldRotate,
      }));
    } catch { /* ignore */ }
  };

  const markDone = () => {
    if (!markPrinted || !hasRows) return;
    const ids = new Set(items.map((i) => i.row?.id).filter(Boolean) as string[]);
    const now = new Date().toISOString();
    commit((p) => ({ ...p, data: { ...p.data, rows: p.data.rows.map((r) => (ids.has(r.id) ? { ...r, printed: now } : r)) } }));
  };

  const run = async () => {
    if (!items.length) { notify('출력할 라벨이 없습니다.'); return; }
    remember();
    if (job.duplex && hasBack) {
      // keep the duplex layout in the project so quick print and shared templates follow it
      const d = { mode: job.duplexMode, mirror: job.mirror, foldDir: job.foldDir, foldRotate: job.foldRotate };
      const o = project.duplex;
      if (!o || o.mode !== d.mode || o.mirror !== d.mirror || o.foldDir !== d.foldDir || o.foldRotate !== d.foldRotate) commit((p) => ({ ...p, duplex: d }));
    }
    const base = safeName(project.name);
    try {
      if (format === 'print') {
        printPages(project, pages, sheetOpts);
        markDone();
        close();
        return;
      }
      setBusy({ done: 0, total: format === 'png' ? items.length : pages.length });
      const onProgress = (done: number, total: number) => setBusy({ done, total });
      if (format === 'pdf') {
        const blob = await exportPdf(project, pages, { mode: pdfMode, dpi, sheet: sheetOpts, onProgress });
        download(blob, `${base}.pdf`);
      } else if (format === 'png') {
        const blob = await exportPngZip(project, items, { dpi, nameTpl, white, onProgress });
        download(blob, `${base}-png.zip`);
      } else {
        if (!splitCol) { notify('분할할 열을 고르세요.'); setBusy(null); return; }
        const blob = await exportSplitPdfZip(project, items, splitCol, { mode: pdfMode, dpi, sheet: sheetOpts, onProgress, startCell: 1, duplex: job.duplex && hasBack && !fold });
        download(blob, `${base}-${safeName(splitCol)}.zip`);
      }
      markDone();
      notify(`${items.length}장 내보내기 완료`);
      close();
    } catch (e) {
      console.error(e);
      notify('내보내기 실패: ' + (e instanceof Error ? e.message : String(e)));
      setBusy(null);
    }
  };

  const scopeCount = (s: Scope) => selectRows(project, { ...opts, scope: s }).length;
  const set = (p: Partial<JobOptions>) => setJob((j) => ({ ...j, ...p }));

  return (
    <Modal title="인쇄 · 내보내기" onClose={close} wide="xl" footer={
      <>
        {busy && <Progress done={busy.done} total={busy.total} label="처리 중" />}
        <span className="spacer" />
        <button onClick={() => printTestPage(project)} title="라벨 테두리·중심 십자선이 있는 정렬 확인용 페이지">정렬 테스트 페이지</button>
        <button onClick={close}>취소</button>
        <button className="primary" disabled={!!busy || !items.length} onClick={run}>
          {format === 'print' ? '인쇄' : '내보내기'} ({items.length}장{format !== 'png' ? ` · ${sheetCount}쪽` : ''})
        </button>
      </>
    }>
      <div className="export-grid">
        <div className="export-opts">
          <Row label="형식">
            <Seg value={format} onChange={setFormat} options={[
              { value: 'print', label: '인쇄', title: '브라우저 인쇄 (벡터, 설치된 글꼴 사용 · "PDF로 저장"도 가능)' },
              { value: 'pdf', label: 'PDF' }, { value: 'png', label: 'PNG (ZIP)' }, { value: 'split', label: '분할 PDF', title: '열 값별로 PDF를 나눠 ZIP으로' },
            ]} />
          </Row>
          {hasRows ? (
            <>
              <Row label="대상">
                <Select value={job.scope} onChange={(v) => set({ scope: v })} options={[
                  { value: 'checked', label: `인쇄 체크된 행 (${scopeCount('checked')})` },
                  { value: 'unprinted', label: `아직 출력 안 한 행 (${scopeCount('unprinted')})` },
                  { value: 'filtered', label: `현재 필터 결과 (${scopeCount('filtered')})` },
                  { value: 'range', label: '행 범위' },
                  { value: 'current', label: `현재 행만 (${currentRow + 1}행)` },
                  { value: 'all', label: `모든 행 (${project.data.rows.length})` },
                ]} />
              </Row>
              {job.scope === 'range' && (
                <Row label="범위">
                  <Num value={job.rangeFrom} step={1} min={1} onChange={(v) => set({ rangeFrom: v })} width={80} />
                  <span>~</span>
                  <Num value={job.rangeTo} step={1} min={1} onChange={(v) => set({ rangeTo: v })} width={80} />
                </Row>
              )}
              <Row label="부수"><Num value={job.copies} step={1} min={1} max={999} onChange={(v) => set({ copies: Math.round(v) })} unit="× 행별 매수" /></Row>
            </>
          ) : (
            <Row label="장 수"><Num value={job.blankCount} step={1} min={1} onChange={(v) => set({ blankCount: Math.round(v) })} unit="장 (데이터 없음)" /></Row>
          )}
          {format !== 'png' && per > 1 && (
            <>
              <Row label="시작 칸"><Num value={job.startCell} step={1} min={1} max={per} onChange={(v) => set({ startCell: Math.round(v) })} unit={`/ ${per}`} /></Row>
              <StartCellPicker cols={layout.cols} rows={layout.rows} value={job.startCell} onChange={(v) => set({ startCell: v })} />
            </>
          )}
          {hasBack && format !== 'png' && (
            <>
              <Check label="양면" checked={job.duplex} onChange={(v) => set({ duplex: v })} />
              {job.duplex && (
                <Row label="방식">
                  <Seg value={job.duplexMode} onChange={(v) => set({ duplexMode: v, startCell: 1 })} options={[
                    { value: 'sheets', label: '앞뒤 따로 인쇄', title: '각 장 뒤에 뒷면 장을 추가 (프린터 양면 정렬이 맞아야 함)' },
                    { value: 'fold', label: '펼쳐서 접기', title: '앞면과 뒷면을 같은 면에 나란히 인쇄 → 잘라서 반으로 접기 (정렬 걱정 없음)' },
                  ]} />
                </Row>
              )}
              {job.duplex && job.duplexMode === 'sheets' && (
                <Row label="뒤집기"><Seg value={job.mirror} onChange={(v) => set({ mirror: v })} options={[{ value: 'cols', label: '긴 쪽 (좌우 반전)' }, { value: 'rows', label: '짧은 쪽 (상하 반전)' }]} /></Row>
              )}
              {job.duplex && job.duplexMode === 'fold' && (
                <>
                  <Row label="뒷면 위치">
                    <Seg value={job.foldDir} onChange={(v) => set({ foldDir: v, foldRotate: v === 'below', startCell: 1 })} options={[
                      { value: 'right', label: '옆에 붙이기', title: '앞면 오른쪽에 뒷면 · 세로선을 따라 접기' },
                      { value: 'below', label: '아래에 붙이기', title: '앞면 아래에 뒷면 · 가로선을 따라 접기' },
                    ]} />
                  </Row>
                  <Check label="뒷면 180° 뒤집어 배치" checked={job.foldRotate} onChange={(v) => set({ foldRotate: v })}
                    title="가로선으로 접을 때(아래에 붙이기) 켜야 접은 뒤 뒷면이 바로 보입니다. 텐트형 명패도 이 설정을 씁니다." />
                  <p className="muted small">
                    한 칸에 {job.foldDir === 'right' ? '앞면 | 뒷면' : '앞면 / 뒷면'}을 붙여 {layout.cols}×{layout.rows}개씩 배치합니다.
                    재단선을 켜면 접는 선은 점선으로 표시됩니다.
                  </p>
                  {layout.grown && <div className="warn">⚠ 용지에 한 칸도 들어가지 않아 용지 크기를 {Math.round(layout.width)}×{Math.round(layout.height)} mm로 늘렸습니다.</div>}
                </>
              )}
            </>
          )}
          {format !== 'png' && (
            <>
              <Check label={pa.bleed > 0 ? `재단선 표시 (재단 여백 ${pa.bleed} mm 바깥)` : '재단선 표시'} checked={cropMarks} onChange={setCropMarks} />
              {bleedClipped && <div className="warn small">칸 간격이 재단 여백×2({2 * pa.bleed} mm)보다 좁아 라벨 사이에서는 재단 여백이 간격의 절반으로 줄어듭니다.</div>}
              <Check label="라벨 테두리 인쇄" checked={outlines} onChange={setOutlines} />
              <Check label={`프린터 보정 적용 (X ${project.calibration.offsetX}, Y ${project.calibration.offsetY} mm)`} checked={calibrate} onChange={setCalibrate} />
            </>
          )}
          {(format === 'pdf' || format === 'split') && (
            <>
              <Row label="PDF 방식">
                <Seg value={pdfMode} onChange={setPdfMode} options={[{ value: 'vector', label: '벡터' }, { value: 'raster', label: '이미지' }]} />
              </Row>
              <p className="muted small">
                {pdfMode === 'vector'
                  ? '도형·바코드·QR·SVG는 벡터로 저장됩니다. 텍스트는 내장한 TTF 글꼴이면 벡터, 아니면 고해상도 이미지로 들어갑니다 (글꼴 관리에서 TTF 내장).'
                  : '페이지 전체를 지정 해상도의 이미지로 저장합니다. 화면과 가장 똑같습니다.'}
              </p>
            </>
          )}
          {format !== 'print' && <Row label="해상도"><Num value={dpi} step={50} min={72} max={1200} unit="dpi" onChange={setDpi} /></Row>}
          {format === 'png' && (
            <>
              <Row label="파일 이름"><input value={nameTpl} onChange={(e) => setNameTpl(e.target.value)} placeholder="{{#seq:0000}}_{{이름}}" /></Row>
              <Check label="흰 배경 (끄면 투명)" checked={white} onChange={setWhite} />
            </>
          )}
          {format === 'split' && (
            <Row label="분할 열"><Select value={splitCol} onChange={setSplitCol} options={project.data.columns.map((c) => ({ value: c, label: c }))} /></Row>
          )}
          {hasRows && <Check label="출력 후 '출력됨'으로 기록" checked={markPrinted} onChange={setMarkPrinted} />}
          {errors.length > 0 && (
            <div className="warn">
              ⚠ 코드 오류 {errors.length}{errors.length > 50 ? '+' : ''}건 — 해당 코드는 빈칸으로 출력됩니다.
              <ul className="err-list">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="export-preview">
          {pages.length ? (
            <>
              <div className="preview-sheet" dangerouslySetInnerHTML={{ __html: previewSvg }} />
              <div className="btn-row center">
                <button disabled={page <= 0} onClick={() => setPage(page - 1)}>◀</button>
                <span>{Math.min(page, pages.length - 1) + 1} / {pages.length}{pages[Math.min(page, pages.length - 1)]?.back ? ' (뒷면)' : ''}</span>
                <button disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>▶</button>
              </div>
            </>
          ) : <p className="muted">출력할 라벨이 없습니다. 대상이나 인쇄 체크를 확인하세요.</p>}
        </div>
      </div>
    </Modal>
  );
}

function StartCellPicker({ cols, rows, value, onChange }: { cols: number; rows: number; value: number; onChange: (v: number) => void }) {
  if (cols * rows > 120) return null;
  return (
    <div className="cell-picker" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} title="이미 사용한 칸은 건너뛰고 클릭한 칸부터 인쇄합니다">
      {Array.from({ length: cols * rows }, (_, i) => (
        <button key={i} className={i + 1 < value ? 'used' : i + 1 === value ? 'start' : ''} onClick={() => onChange(i + 1)}>{i + 1}</button>
      ))}
    </div>
  );
}
