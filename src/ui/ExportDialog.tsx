import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { download, exportPdf, exportPngZip, exportSplitPdfZip, printPages, printTestPage, safeName } from '../io/export';
import { buildItems, DEFAULT_DUPLEX, groupItems, jobFold, paginate, projectDuplex, selectRows, type GroupOptions, type JobOptions, type Scope } from '../render/jobs';
import { fetchPictures, pictureUrls } from '../render/images';
import { preprintSheetMarkup } from '../render/preprint';
import { ISSUE_LABEL, issueText, preflight, type Issue, type IssueKind } from '../render/preflight';
import { sheetDocument, sheetLayout, testPointsFit, type TestPoints } from '../render/svg';
import type { Project } from '../model/types';
import { useStore } from '../store';
import { Check, Modal, Num, PrintSetupAlert, Progress, Row, Select, Seg } from './controls';
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
  const [markLabels, setMarkLabels] = useState<boolean>(saved.markLabels ?? true);
  const [testPoints, setTestPoints] = useState<TestPoints>(saved.testPoints ?? {});
  const [outlines, setOutlines] = useState<boolean>(false);
  const [calibrate, setCalibrate] = useState<boolean>(saved.calibrate ?? true);
  const [pdfMode, setPdfMode] = useState<'vector' | 'raster'>(saved.pdfMode ?? 'vector');
  const [dpi, setDpi] = useState<number>(saved.dpi ?? project.paper.dpi);
  const [nameTpl, setNameTpl] = useState<string>(saved.nameTpl ?? '{{#seq:0000}}');
  const [white, setWhite] = useState<boolean>(saved.white ?? true);
  const [splitCol, setSplitCol] = useState<string>(project.data.columns.find((c) => /구분|type|category|role|ruolo|categoria|rôle|catégorie/i.test(c)) ?? project.data.columns[0] ?? '');
  const [markPrinted, setMarkPrinted] = useState<boolean>(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);

  const filteredIds = useMemo(() => filterRows(project, filter), [project, filter]);
  const opts: JobOptions = { ...job, filteredIds, currentRow };
  const [group, setGroup] = useState<GroupOptions>({ column: '', newSheet: true, separator: false });
  const grouping = format === 'print' || format === 'pdf';
  const labels = useMemo(() => buildItems(project, opts), [project, job, filteredIds, currentRow]); // eslint-disable-line react-hooks/exhaustive-deps
  // with grouping, items also hold the divider labels; `labels` stays the data labels only
  const items = useMemo(() => (grouping ? groupItems(project, labels, group) : labels), [project, labels, group, grouping]);
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

  const check = useMemo(() => preflight(project, labels, { back: job.duplex && hasBack }), [project, labels, job.duplex, hasBack]);
  const [showAll, setShowAll] = useState(false);
  // go to the label and object an issue is about
  const jump = (x: Issue) => {
    const s = useStore.getState();
    close();
    s.setDesign(x.designId, x.side);
    if (project.data.rows.length) s.setCurrentRow(x.rowIndex);
    s.select([x.objId]);
  };

  const sheetOpts = { cropMarks, markLabels, testPoints, outlines, calibrate, mirror: job.mirror, fold };
  const markOpts = { cropMarks, markLabels, testPoints };
  const setTp = (k: keyof TestPoints) => (v: boolean) => setTestPoints((t) => ({ ...t, [k]: v }));
  const [showPreprint, setShowPreprint] = useState(true);
  const previewSvg = useMemo(() => {
    const pg = pages[Math.min(page, pages.length - 1)];
    if (!pg) return '';
    const svg = sheetDocument(project, pg.cells, { ...sheetOpts, outlines: true, calibrate: false, mirror: pg.back ? job.mirror : 'none' }, 999);
    // the stock's own artwork (never printed) sits on the fronts of the label grid; fold layouts use plain paper
    return showPreprint && !pg.back && !fold ? svg.replace(/<\/svg>$/, preprintSheetMarkup(project.paper) + '</svg>') : svg;
  }, [pages, page, project, cropMarks, markLabels, testPoints, job.mirror, fold?.dir, fold?.rotate, showPreprint]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        format, cropMarks, markLabels, testPoints, calibrate, pdfMode, dpi, nameTpl, white,
        duplexMode: job.duplexMode, foldDir: job.foldDir, foldRotate: job.foldRotate,
      }));
    } catch { /* ignore */ }
  };

  const markDone = () => {
    if (!markPrinted || !hasRows) return;
    const ids = new Set(labels.map((i) => i.row?.id).filter(Boolean) as string[]);
    const now = new Date().toISOString();
    commit((p) => ({ ...p, data: { ...p.data, rows: p.data.rows.map((r) => (ids.has(r.id) ? { ...r, printed: now } : r)) } }));
  };

  const run = async () => {
    if (!labels.length) { notify(t('출력할 라벨이 없습니다.')); return; }
    remember();
    if (job.duplex && hasBack) {
      // keep the duplex layout in the project so quick print and shared templates follow it
      const d = { mode: job.duplexMode, mirror: job.mirror, foldDir: job.foldDir, foldRotate: job.foldRotate };
      const o = project.duplex;
      if (!o || o.mode !== d.mode || o.mirror !== d.mirror || o.foldDir !== d.foldDir || o.foldRotate !== d.foldRotate) commit((p) => ({ ...p, duplex: d }));
    }
    const base = safeName(project.name);
    try {
      // pictures linked from the web go into the output as data, when their servers allow it
      const urls = pictureUrls(project, labels);
      if (urls.length) {
        setBusy({ done: 0, total: urls.length });
        await fetchPictures(urls, (done, total) => setBusy({ done, total }));
        setBusy(null);
      }
      if (format === 'print') {
        printPages(project, pages, sheetOpts);
        markDone();
        close();
        return;
      }
      setBusy({ done: 0, total: format === 'png' ? labels.length : pages.length });
      const onProgress = (done: number, total: number) => setBusy({ done, total });
      if (format === 'pdf') {
        const blob = await exportPdf(project, pages, { mode: pdfMode, dpi, sheet: sheetOpts, onProgress });
        download(blob, `${base}.pdf`);
      } else if (format === 'png') {
        const blob = await exportPngZip(project, labels, { dpi, nameTpl, white, onProgress });
        download(blob, `${base}-png.zip`);
      } else {
        if (!splitCol) { notify(t('분할할 열을 고르세요.')); setBusy(null); return; }
        const blob = await exportSplitPdfZip(project, labels, splitCol, { mode: pdfMode, dpi, sheet: sheetOpts, onProgress, startCell: 1, duplex: job.duplex && hasBack && !fold });
        download(blob, `${base}-${safeName(splitCol)}.zip`);
      }
      markDone();
      notify(t('{n}장 내보내기 완료', { n: labels.length }));
      close();
    } catch (e) {
      console.error(e);
      notify(t('내보내기 실패: {error}', { error: e instanceof Error ? e.message : String(e) }));
      setBusy(null);
    }
  };

  const scopeCount = (s: Scope) => selectRows(project, { ...opts, scope: s }).length;
  const set = (p: Partial<JobOptions>) => setJob((j) => ({ ...j, ...p }));

  return (
    <Modal title={t('인쇄 · 내보내기')} onClose={close} wide="xl" footer={
      <>
        {busy ? <Progress done={busy.done} total={busy.total} label={t('처리 중')} />
          : format !== 'png' && <PrintSetupAlert width={layout.width} height={layout.height} pdf={format !== 'print'} />}
        <span className="spacer" />
        <button onClick={() => printTestPage(project, markOpts)} title={t('라벨 테두리·중심 십자선이 있는 정렬 확인용 페이지 (재단선·테스트 포인트 설정도 함께 인쇄)')}>{t('정렬 테스트 페이지')}</button>
        <button onClick={close}>{t('취소')}</button>
        <button className="primary" disabled={!!busy || !labels.length} onClick={run}>
          {format === 'print' ? t('인쇄') : t('내보내기')} ({t('{n}장', { n: labels.length })}{format !== 'png' ? ` · ${t('{n}쪽', { n: sheetCount })}` : ''})
        </button>
      </>
    }>
      <div className="export-grid">
        <div className="export-opts">
          <Row label={t('형식')} tour="export-format">
            <Seg value={format} onChange={setFormat} options={[
              { value: 'print', label: t('인쇄'), title: t('브라우저 인쇄 (벡터, 설치된 글꼴 사용 · "PDF로 저장"도 가능)') },
              { value: 'pdf', label: 'PDF' }, { value: 'png', label: 'PNG (ZIP)' }, { value: 'split', label: t('분할 PDF'), title: t('열 값별로 PDF를 나눠 ZIP으로') },
            ]} />
          </Row>
          {hasRows ? (
            <>
              <Row label={t('대상')} tour="export-scope">
                <Select value={job.scope} onChange={(v) => set({ scope: v })} options={[
                  { value: 'checked', label: `${t('인쇄 체크된 행')} (${scopeCount('checked')})` },
                  { value: 'unprinted', label: `${t('아직 출력 안 한 행')} (${scopeCount('unprinted')})` },
                  { value: 'filtered', label: `${t('현재 필터 결과')} (${scopeCount('filtered')})` },
                  { value: 'range', label: t('행 범위') },
                  { value: 'current', label: t('현재 행만 ({n}행)', { n: currentRow + 1 }) },
                  { value: 'all', label: `${t('모든 행')} (${project.data.rows.length})` },
                ]} />
              </Row>
              {job.scope === 'range' && (
                <Row label={t('범위')}>
                  <Num value={job.rangeFrom} step={1} min={1} onChange={(v) => set({ rangeFrom: v })} width={80} />
                  <span>~</span>
                  <Num value={job.rangeTo} step={1} min={1} onChange={(v) => set({ rangeTo: v })} width={80} />
                </Row>
              )}
              {grouping && (
                <Row label={t('묶음')}>
                  <Select value={group.column} onChange={(v) => setGroup({ ...group, column: v })} title={t('열 값이 같은 라벨끼리 모아 가나다순으로 출력합니다')}
                    options={[{ value: '', label: t('묶지 않음') }, ...project.data.columns.map((c) => ({ value: c, label: t('{col}별로 묶기', { col: c }) }))]} />
                </Row>
              )}
              {grouping && group.column && (
                <Row>
                  <Check label={t('묶음마다 새 장')} checked={group.newSheet} onChange={(v) => setGroup({ ...group, newSheet: v })} />
                  <Check label={t('묶음 앞에 구분 라벨')} checked={group.separator} onChange={(v) => setGroup({ ...group, separator: v })}
                    title={t('묶음 이름과 장 수를 적은 라벨을 각 묶음 앞에 넣습니다 (나눠 줄 때 구분용)')} />
                </Row>
              )}
              <Row label={t('부수')}><Num value={job.copies} step={1} min={1} max={999} onChange={(v) => set({ copies: Math.round(v) })} unit={t('× 행별 매수')} /></Row>
            </>
          ) : (
            <Row label={t('장 수')}><Num value={job.blankCount} step={1} min={1} onChange={(v) => set({ blankCount: Math.round(v) })} unit={t('장 (데이터 없음)')} /></Row>
          )}
          {format !== 'png' && per > 1 && (
            <>
              <Row label={t('시작 칸')}><Num value={job.startCell} step={1} min={1} max={per} onChange={(v) => set({ startCell: Math.round(v) })} unit={`/ ${per}`} /></Row>
              <StartCellPicker cols={layout.cols} rows={layout.rows} value={job.startCell} onChange={(v) => set({ startCell: v })} />
            </>
          )}
          {hasBack && format !== 'png' && (
            <>
              <Check label={t('양면')} checked={job.duplex} onChange={(v) => set({ duplex: v })} />
              {job.duplex && (
                <Row label={t('방식')}>
                  <Seg value={job.duplexMode} onChange={(v) => set({ duplexMode: v, startCell: 1 })} options={[
                    { value: 'sheets', label: t('앞뒤 따로 인쇄'), title: t('각 장 뒤에 뒷면 장을 추가 (프린터 양면 정렬이 맞아야 함)') },
                    { value: 'fold', label: t('펼쳐서 접기'), title: t('앞면과 뒷면을 같은 면에 나란히 인쇄 → 잘라서 반으로 접기 (정렬 걱정 없음)') },
                  ]} />
                </Row>
              )}
              {job.duplex && job.duplexMode === 'sheets' && (
                <Row label={t('뒤집기')}><Seg value={job.mirror} onChange={(v) => set({ mirror: v })} options={[{ value: 'cols', label: t('긴 쪽 (좌우 반전)') }, { value: 'rows', label: t('짧은 쪽 (상하 반전)') }]} /></Row>
              )}
              {job.duplex && job.duplexMode === 'fold' && (
                <>
                  <Row label={t('뒷면 위치')}>
                    <Seg value={job.foldDir} onChange={(v) => set({ foldDir: v, foldRotate: v === 'below', startCell: 1 })} options={[
                      { value: 'right', label: t('옆에 붙이기'), title: t('앞면 오른쪽에 뒷면 · 세로선을 따라 접기') },
                      { value: 'below', label: t('아래에 붙이기'), title: t('앞면 아래에 뒷면 · 가로선을 따라 접기') },
                    ]} />
                  </Row>
                  <Check label={t('뒷면 180° 뒤집어 배치')} checked={job.foldRotate} onChange={(v) => set({ foldRotate: v })}
                    title={t('가로선으로 접을 때(아래에 붙이기) 켜야 접은 뒤 뒷면이 바로 보입니다. 텐트형 명패도 이 설정을 씁니다.')} />
                  <p className="muted small">
                    {t('한 칸에 {pair}을 붙여 {cols}×{rows}개씩 배치합니다.', { pair: `${t('앞면')} ${job.foldDir === 'right' ? '|' : '/'} ${t('뒷면')}`, cols: layout.cols, rows: layout.rows })}
                    {' '}{t('재단선을 켜면 접는 선은 점선으로 표시됩니다.')}
                  </p>
                  {layout.grown && <div className="warn">⚠ {t('용지에 한 칸도 들어가지 않아 용지 크기를 {w}×{h} mm로 늘렸습니다.', { w: Math.round(layout.width), h: Math.round(layout.height) })}</div>}
                </>
              )}
            </>
          )}
          {format !== 'png' && (
            <>
              <Check label={pa.bleed > 0 ? t('재단선 표시 (재단선 + 재단 여백 {n} mm 기준선)', { n: pa.bleed }) : t('재단선 표시')} checked={cropMarks} onChange={setCropMarks} />
              {cropMarks && <Check label={t('기준선 이름 표시 (TRIM 재단선 · BLEED 재단 여백 · FOLD 접는 선)')} checked={markLabels} onChange={setMarkLabels} />}
              {bleedClipped && <div className="warn small">{t('칸 간격이 재단 여백×2({n} mm)보다 좁아 라벨 사이에서는 재단 여백이 간격의 절반으로 줄어듭니다.', { n: 2 * pa.bleed })}</div>}
              <Row label={t('테스트 포인트')}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Check label={t('색상 패치 (C M Y K R G B)')} checked={!!testPoints.process} onChange={setTp('process')} />
                  <Check label={t('회색 단계 (100~5%)')} checked={!!testPoints.gray} onChange={setTp('gray')} />
                  <Check label={t('디자인에 쓰인 색')} checked={!!testPoints.design} onChange={setTp('design')} />
                  <Check label={t('선 굵기 (0.1 · 0.2 · 0.3 mm)')} checked={!!testPoints.lines} onChange={setTp('lines')} />
                  <Check label={t('맞춤 표시 (레지스트레이션)')} checked={!!testPoints.registration} onChange={setTp('registration')} />
                </div>
              </Row>
              {!testPointsFit(project, sheetOpts) && <div className="warn small">{t('라벨 바깥 여백이 좁아 테스트 포인트를 넣을 자리가 없습니다. 항목을 줄이거나 용지 여백을 늘리세요.')}</div>}
              <Check label={t('라벨 테두리 인쇄')} checked={outlines} onChange={setOutlines} />
              <Check label={t('프린터 보정 적용 (X {x}, Y {y} mm)', { x: project.calibration.offsetX, y: project.calibration.offsetY })} checked={calibrate} onChange={setCalibrate} />
            </>
          )}
          {(format === 'pdf' || format === 'split') && (
            <>
              <Row label={t('PDF 방식')}>
                <Seg value={pdfMode} onChange={setPdfMode} options={[{ value: 'vector', label: t('벡터') }, { value: 'raster', label: t('이미지') }]} />
              </Row>
              <p className="muted small">
                {pdfMode === 'vector'
                  ? t('도형·바코드·QR·SVG는 벡터로 저장됩니다. 텍스트는 내장한 TTF 글꼴이면 벡터, 아니면 고해상도 이미지로 들어갑니다 (글꼴 관리에서 TTF 내장).')
                  : t('페이지 전체를 지정 해상도의 이미지로 저장합니다. 화면과 가장 똑같습니다.')}
              </p>
            </>
          )}
          {format !== 'print' && <Row label={t('해상도')}><Num value={dpi} step={50} min={72} max={1200} unit="dpi" onChange={setDpi} /></Row>}
          {format === 'png' && (
            <>
              <Row label={t('파일 이름')}><input value={nameTpl} onChange={(e) => setNameTpl(e.target.value)} placeholder={`{{#seq:0000}}_{{${t('이름')}}}`} /></Row>
              <Check label={t('흰 배경 (끄면 투명)')} checked={white} onChange={setWhite} />
            </>
          )}
          {format === 'split' && (
            <Row label={t('분할 열')}><Select value={splitCol} onChange={setSplitCol} options={project.data.columns.map((c) => ({ value: c, label: c }))} /></Row>
          )}
          {hasRows && <Check label={t("출력 후 '출력됨'으로 기록")} checked={markPrinted} onChange={setMarkPrinted} />}
          <div className={check.total ? 'warn preflight' : 'ok-box preflight'}>
            <strong>{t('인쇄 전 검사')}</strong>{' '}
            {check.total ? (
              <>
                <span className="preflight-counts">
                  {(Object.keys(ISSUE_LABEL) as IssueKind[]).filter((k) => check.counts[k]).map((k) => <span key={k}>{t(ISSUE_LABEL[k])} {check.counts[k]}</span>)}
                </span>
                <ul className="err-list">
                  {check.issues.slice(0, showAll ? check.issues.length : 8).map((x, i) => (
                    <li key={i}><button className="link" onClick={() => jump(x)} title={t('이 라벨과 개체로 이동')}>{issueText(x)}</button> <span className="muted small">{t(ISSUE_LABEL[x.kind])}</span></li>
                  ))}
                </ul>
                {check.issues.length > 8 && <button className="link small" onClick={() => setShowAll(!showAll)}>{showAll ? t('접기') : t('모두 보기 ({n})', { n: `${check.issues.length}${check.total > check.issues.length ? '+' : ''}` })}</button>}
              </>
            ) : <span>✓ {t('문제를 찾지 못했습니다.')}</span>}
          </div>
        </div>
        <div className="export-preview">
          {pages.length ? (
            <>
              <div className="preview-sheet" dangerouslySetInnerHTML={{ __html: previewSvg }} />
              {pa.preprint && !fold && <Check label={t('견출지 테두리 겹쳐 보기 (인쇄 안 됨)')} checked={showPreprint} onChange={setShowPreprint} />}
              <div className="btn-row center">
                <button disabled={page <= 0} onClick={() => setPage(page - 1)}>◀</button>
                <span>{Math.min(page, pages.length - 1) + 1} / {pages.length}{pages[Math.min(page, pages.length - 1)]?.back ? ` (${t('뒷면')})` : ''}</span>
                <button disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>▶</button>
              </div>
            </>
          ) : <p className="muted">{t('출력할 라벨이 없습니다. 대상이나 인쇄 체크를 확인하세요.')}</p>}
        </div>
      </div>
    </Modal>
  );
}

function StartCellPicker({ cols, rows, value, onChange }: { cols: number; rows: number; value: number; onChange: (v: number) => void }) {
  if (cols * rows > 120) return null;
  return (
    <div className="cell-picker" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} title={t('이미 사용한 칸은 건너뛰고 클릭한 칸부터 인쇄합니다')}>
      {Array.from({ length: cols * rows }, (_, i) => (
        <button key={i} className={i + 1 < value ? 'used' : i + 1 === value ? 'start' : ''} onClick={() => onChange(i + 1)}>{i + 1}</button>
      ))}
    </div>
  );
}
