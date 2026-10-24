import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { centerGrid } from '../model/presets';
import type { Paper, Preprint } from '../model/types';
import { preprintMarkup, preprintSheetMarkup } from '../render/preprint';
import { useStore } from '../store';
import { Check, Color, Modal, Num, Seg } from './controls';

type PageKind = 'a4' | 'letter' | 'current';
const PAGES: Record<Exclude<PageKind, 'current'>, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const fit = (avail: number, unit: number, gap: number) => Math.max(1, Math.floor((avail + gap + 1e-6) / (unit + gap)));

/**
 * Builds the paper for stock that already carries printed artwork, such as index labels
 * (견출지) with a coloured frame: the writable area, the frame around it and the spacing
 * between labels define the grid, and the frame is kept as a guide that is never printed.
 */
export function PreprintWizard() {
  const paper = useStore((s) => s.project.paper);
  const { close, commit } = useStore.getState();
  const cur = paper.preprint;

  const [page, setPage] = useState<PageKind>(cur ? 'current' : 'a4');
  const [f, setF] = useState(() => ({
    innerW: cur ? r2(paper.labelWidth - 2 * cur.borderSide) : 30,
    innerH: cur ? r2(paper.labelHeight - cur.borderTop - cur.borderBottom) : 14,
    borderTop: cur?.borderTop ?? 4,
    borderBottom: cur?.borderBottom ?? 2.5,
    borderSide: cur?.borderSide ?? 2.5,
    outerRadius: cur ? paper.cornerRadius : 2,
    innerRadius: cur?.innerRadius ?? 1.5,
    gapX: cur ? paper.gapX : 3,
    gapY: cur ? paper.gapY : 3,
    margin: cur ? Math.min(paper.marginLeft, paper.marginTop) : 8,
    color: cur?.color ?? '#2563eb',
  }));
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const pg = page === 'current' ? { width: paper.width, height: paper.height } : PAGES[page];
  const lw = r2(f.innerW + 2 * f.borderSide), lh = r2(f.innerH + f.borderTop + f.borderBottom);
  const maxCols = fit(pg.width - 2 * f.margin, lw, f.gapX), maxRows = fit(pg.height - 2 * f.margin, lh, f.gapY);
  const [grid, setGrid] = useState<{ cols: number; rows: number } | null>(cur ? { cols: paper.cols, rows: paper.rows } : null);
  // without an explicit count the grid follows the sizes and fills the page
  const cols = Math.min(grid?.cols ?? maxCols, maxCols), rows = Math.min(grid?.rows ?? maxRows, maxRows);

  const next: Paper = useMemo(() => {
    const preprint: Preprint = {
      color: f.color, borderTop: f.borderTop, borderBottom: f.borderBottom, borderSide: f.borderSide,
      innerRadius: f.innerRadius, show: cur?.show ?? true,
    };
    return {
      ...paper, ...pg,
      name: t('견출지 {w}×{h}', { w: lw, h: lh }),
      labelWidth: lw, labelHeight: lh, cornerRadius: f.outerRadius,
      cols, rows, gapX: f.gapX, gapY: f.gapY,
      ...centerGrid(pg.width, pg.height, lw, lh, cols, rows, f.gapX, f.gapY),
      bleed: 0, preprint,
    };
  }, [paper, pg.width, pg.height, f, lw, lh, cols, rows, cur?.show]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    commit((p) => ({ ...p, paper: next }));
    close();
    setTimeout(() => window.dispatchEvent(new Event('labelloom:fit')), 0);
  };

  const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${next.width + 4} ${next.height + 4}">` +
    `<rect width="${next.width}" height="${next.height}" fill="#fff" stroke="#334155" stroke-width="0.6"/>${preprintSheetMarkup(next)}</svg>`;
  const pad = 6;
  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${lw + 2 * pad} ${lh + 2 * pad}">${preprintMarkup(next)}` +
    `<rect x="${f.borderSide}" y="${f.borderTop}" width="${Math.max(0, f.innerW)}" height="${Math.max(0, f.innerH)}" rx="${f.innerRadius}" fill="none" stroke="#f97316" stroke-width="${lw / 200}" stroke-dasharray="${lw / 60} ${lw / 90}"/></svg>`;

  return (
    <Modal title={t('견출지 마법사')} wide onClose={close} footer={<><span className="muted small">{t('테두리는 화면에만 보이고 인쇄되지 않습니다.')}</span><span className="spacer" /><button onClick={close}>{t('취소')}</button><button className="primary" onClick={apply}>{t('적용')}</button></>}>
      <div className="preprint-wizard">
        <div className="pw-form">
          <p className="muted small" style={{ marginTop: 0 }}>{t('그림이 미리 인쇄된 라벨지(견출지 등)에 내용만 인쇄할 때 씁니다. 라벨지를 자로 재어 입력하면 그 모양대로 용지와 칸이 설정되고, 인쇄된 테두리 위치가 디자인 화면에 겹쳐 보입니다.')}</p>
          <p className="sub">{t('용지')}</p>
          <Seg value={page} onChange={setPage} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'current', label: t('현재 ({w}×{h})', { w: paper.width, h: paper.height }) }]} />
          <p className="sub">{t('입력 영역 (안쪽 흰 부분)')}</p>
          <div className="grid2">
            <Num label={t('폭')} value={f.innerW} step={0.5} min={1} unit="mm" onChange={(v) => set({ innerW: v })} />
            <Num label={t('높이')} value={f.innerH} step={0.5} min={1} unit="mm" onChange={(v) => set({ innerH: v })} />
          </div>
          <p className="sub">{t('테두리 두께 (라벨 가장자리 ~ 입력 영역)')}</p>
          <div className="grid2">
            <Num label={t('위')} value={f.borderTop} step={0.5} min={0} unit="mm" onChange={(v) => set({ borderTop: v })} />
            <Num label={t('아래')} value={f.borderBottom} step={0.5} min={0} unit="mm" onChange={(v) => set({ borderBottom: v })} />
            <Num label={t('좌우')} value={f.borderSide} step={0.5} min={0} unit="mm" onChange={(v) => set({ borderSide: v })} />
          </div>
          <p className="sub">{t('모서리·색')}</p>
          <div className="grid2">
            <Num label={t('바깥')} value={f.outerRadius} step={0.5} min={0} unit="mm" onChange={(v) => set({ outerRadius: v })} />
            <Num label={t('안쪽')} value={f.innerRadius} step={0.5} min={0} unit="mm" onChange={(v) => set({ innerRadius: v })} />
          </div>
          <Color value={f.color} onChange={(c) => set({ color: c })} title={t('테두리 색 (화면 표시용)')} />
          <p className="sub">{t('견출지 사이 간격·배치')}</p>
          <div className="grid2">
            <Num label={t('가로 간격')} value={f.gapX} step={0.5} min={0} unit="mm" onChange={(v) => set({ gapX: v })} />
            <Num label={t('세로 간격')} value={f.gapY} step={0.5} min={0} unit="mm" onChange={(v) => set({ gapY: v })} />
            <Num label={t('가로 칸')} value={cols} step={1} min={1} max={maxCols} onChange={(v) => setGrid({ cols: Math.round(v), rows })} />
            <Num label={t('세로 칸')} value={rows} step={1} min={1} max={maxRows} onChange={(v) => setGrid({ cols, rows: Math.round(v) })} />
            <Num label={t('최소 여백')} title={t('용지 가장자리에서 띄울 거리 (칸 수 계산용, 실제 배치는 가운데 정렬)')} value={f.margin} step={0.5} min={0} unit="mm" onChange={(v) => set({ margin: v })} />
          </div>
          <Check label={t('용지에 들어가는 최대 칸 수 ({cols}×{rows})', { cols: maxCols, rows: maxRows })} checked={!grid} onChange={(v) => setGrid(v ? null : { cols, rows })} />
          <p className="muted small">{t('라벨 한 칸: {w} × {h} mm · {n}칸 · 가로 피치 {px} / 세로 피치 {py} mm', { w: lw, h: lh, n: cols * rows, px: r2(lw + f.gapX), py: r2(lh + f.gapY) })}</p>
        </div>
        <div className="pw-preview">
          <div className="pw-label" dangerouslySetInnerHTML={{ __html: labelSvg }} />
          <div className="pw-sheet" dangerouslySetInnerHTML={{ __html: sheetSvg }} />
        </div>
      </div>
    </Modal>
  );
}
