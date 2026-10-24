import { useState } from 'react';
import {
  cellKey, cellSpans, deleteCol, deleteRow, insertCol, insertRow, mergeCells, pasteGrid, tableSize, unmergeAt,
} from '../model/table';
import type { LabelObject, TableCellStyle, TableObj } from '../model/types';
import { act, useStore } from '../store';
import { Check, Color, Num, Row, Section, Seg } from './controls';

type Pos = { r: number; c: number };

const quoteFamily = (f: string) => (/^[\w-]+$/.test(f) ? f : `"${f}"`);
const primaryFamily = (css: string) => css.split(',')[0].trim().replace(/^["']|["']$/g, '');

export function TableSection({ o }: { o: TableObj }) {
  const columns = useStore((s) => s.project.data.columns);
  const up = (p: Partial<TableObj>) => act.update([o.id], p as Partial<LabelObject>);
  const { rows, cols } = tableSize(o);
  const [active, setActive] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const a = { r: Math.min(active.r, rows - 1), c: Math.min(active.c, cols - 1) };
  const range = anchor ? {
    r0: Math.min(anchor.r, a.r), r1: Math.max(anchor.r, a.r), c0: Math.min(anchor.c, a.c), c1: Math.max(anchor.c, a.c),
  } : { r0: a.r, r1: a.r, c0: a.c, c1: a.c };
  const multi = range.r0 !== range.r1 || range.c0 !== range.c1;
  const spans = cellSpans(o);
  const merged = !!spans.get(cellKey(a.r, a.c));

  const setCell = (r: number, c: number, v: string) =>
    up({ cells: o.cells.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });

  /** Apply a style patch to every cell in the selected range. */
  const styleRange = (patch: Partial<TableCellStyle>) => {
    const styles = { ...o.styles };
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
      const k = cellKey(r, c);
      const next: TableCellStyle = { ...styles[k], ...patch };
      (Object.keys(next) as (keyof TableCellStyle)[]).forEach((key) => { if (next[key] === undefined || next[key] === '') delete next[key]; });
      if (Object.keys(next).length) styles[k] = next; else delete styles[k];
    }
    up({ styles });
  };
  const st = o.styles[cellKey(a.r, a.c)] ?? {};

  const pick = (p: Pos, shift: boolean) => {
    if (shift) setAnchor((x) => x ?? a); else setAnchor(null);
    setActive(p);
  };

  const apply = (patch: Partial<TableObj> | null, next?: Pos) => {
    if (!patch) return;
    up(patch);
    if (next) { setActive(next); setAnchor(null); }
  };

  return (
    <>
      <Section title={`표 · ${rows}행 × ${cols}열`}>
        <div className="table-grid-wrap">
          <table className="table-grid">
            <tbody>
              {o.cells.map((row, r) => (
                <tr key={r}>
                  {row.map((v, c) => {
                    const span = spans.get(cellKey(r, c));
                    if (span === null) return null;
                    const sel = r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
                    const cs = o.styles[cellKey(r, c)];
                    const head = (o.headerRow && r === 0) || (o.headerCol && c === 0);
                    const bg = cs?.fill || (head ? o.headerFill : o.fill);
                    return (
                      <td key={c} rowSpan={span?.rs} colSpan={span?.cs} className={sel ? (r === a.r && c === a.c ? 'active' : 'sel') : ''}>
                        <textarea
                          value={v} rows={Math.max(1, v.split('\n').length)} spellCheck={false}
                          style={{ background: bg || undefined, color: bg ? '#111' : undefined, fontWeight: cs?.bold ?? head ? 700 : 400 }}
                          onMouseDown={(e) => pick({ r, c }, e.shiftKey)}
                          onFocus={() => { if (active.r !== r || active.c !== c) pick({ r, c }, false); }}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onPaste={(e) => {
                            const t = e.clipboardData.getData('text/plain');
                            if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return;
                            e.preventDefault();
                            up(pasteGrid(o, t, r, c));
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Shift+클릭으로 여러 칸 선택 · 엑셀에서 복사한 표를 칸에 붙여넣으면 한꺼번에 채워집니다 · 칸 안에서 Enter는 줄바꿈</p>
        <div className="btn-row">
          <button onClick={() => apply(insertRow(o, a.r), { r: a.r, c: a.c })} title="선택 칸 위에 행 추가">행 ↑+</button>
          <button onClick={() => apply(insertRow(o, a.r + 1), { r: a.r + 1, c: a.c })} title="선택 칸 아래에 행 추가">행 ↓+</button>
          <button onClick={() => apply(deleteRow(o, a.r), { r: Math.max(0, a.r - 1), c: a.c })} disabled={rows <= 1}>행 삭제</button>
        </div>
        <div className="btn-row">
          <button onClick={() => apply(insertCol(o, a.c), { r: a.r, c: a.c })} title="선택 칸 왼쪽에 열 추가">열 ←+</button>
          <button onClick={() => apply(insertCol(o, a.c + 1), { r: a.r, c: a.c + 1 })} title="선택 칸 오른쪽에 열 추가">열 →+</button>
          <button onClick={() => apply(deleteCol(o, a.c), { r: a.r, c: Math.max(0, a.c - 1) })} disabled={cols <= 1}>열 삭제</button>
        </div>
        <div className="btn-row">
          <button disabled={!multi} onClick={() => apply(mergeCells(o, { r: range.r0, c: range.c0 }, { r: range.r1, c: range.c1 }), { r: range.r0, c: range.c0 })}
            title="Shift+클릭으로 고른 칸들을 하나로 합칩니다 (예: 2시간 연속 수업)">칸 병합</button>
          <button disabled={!merged} onClick={() => apply(unmergeAt(o, a.r, a.c))}>병합 해제</button>
          <select value="" title="선택 칸에 데이터 열 넣기" onChange={(e) => e.target.value && setCell(a.r, a.c, (o.cells[a.r][a.c] ?? '') + `{{${e.target.value}}}`)}>
            <option value="">+ 데이터 열</option>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </Section>

      <Section title={multi ? `선택한 칸 서식 (${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)}칸)` : `칸 서식 (${a.r + 1}행 ${a.c + 1}열)`}>
        <Row label="칸 배경">
          <Color value={st.fill ?? ''} allowNone onChange={(c) => styleRange({ fill: c || undefined })} />
          {st.fill && <button className="icon small" title="기본값으로" onClick={() => styleRange({ fill: undefined })}>✕</button>}
        </Row>
        <Row label="글자색">
          <Color value={st.color ?? ''} allowNone onChange={(c) => styleRange({ color: c || undefined })} />
          {st.color && <button className="icon small" title="기본값으로" onClick={() => styleRange({ color: undefined })}>✕</button>}
        </Row>
        <Row>
          <Seg value={st.bold === undefined ? 'auto' : st.bold ? 'b' : 'n'} onChange={(v) => styleRange({ bold: v === 'auto' ? undefined : v === 'b' })}
            options={[{ value: 'auto', label: '기본', title: '머리글만 굵게' }, { value: 'b', label: <b>굵게</b> }, { value: 'n', label: '보통' }]} />
          <Seg value={st.align ?? 'auto'} onChange={(v) => styleRange({ align: v === 'auto' ? undefined : v })}
            options={[{ value: 'auto', label: '기본' }, { value: 'left', label: '⇤' }, { value: 'center', label: '↔' }, { value: 'right', label: '⇥' }]} />
        </Row>
        <div className="grid2">
          <Num label="열 너비" title={`${a.c + 1}열의 상대 너비 (다른 열과의 비율)`} value={o.colWidths[a.c] ?? 1} step={0.1} min={0.05}
            onChange={(v) => up({ colWidths: Array.from({ length: cols }, (_, i) => (i === a.c ? v : o.colWidths[i] ?? 1)) })} />
          <Num label="행 높이" title={`${a.r + 1}행의 상대 높이 (다른 행과의 비율)`} value={o.rowHeights[a.r] ?? 1} step={0.1} min={0.05}
            onChange={(v) => up({ rowHeights: Array.from({ length: rows }, (_, i) => (i === a.r ? v : o.rowHeights[i] ?? 1)) })} />
        </div>
        <div className="btn-row">
          <button onClick={() => up({ colWidths: Array(cols).fill(1) })}>열 너비 같게</button>
          <button onClick={() => up({ rowHeights: Array(rows).fill(1) })}>행 높이 같게</button>
        </div>
      </Section>

      <Section title="표 서식">
        <Row label="글꼴">
          <input list="font-list" value={primaryFamily(o.fontFamily)} onChange={(e) => up({ fontFamily: `${quoteFamily(e.target.value)}, "Malgun Gothic", sans-serif` })} />
        </Row>
        <div className="grid2">
          <Num label="크기" value={o.fontSize} step={0.5} min={1} unit="pt" title="칸에 넘치면 최소 크기까지 자동 축소" onChange={(v) => up({ fontSize: v })} />
          <Num label="최소" value={o.minFontSize} step={0.5} min={1} unit="pt" onChange={(v) => up({ minFontSize: v })} />
          <Num label="안쪽 여백" value={o.padding} step={0.1} min={0} unit="mm" onChange={(v) => up({ padding: v })} />
        </div>
        <Row>
          <Seg value={o.align} onChange={(v) => up({ align: v })} options={[{ value: 'left', label: '⇤', title: '왼쪽' }, { value: 'center', label: '↔', title: '가운데' }, { value: 'right', label: '⇥', title: '오른쪽' }]} />
          <Seg value={o.vAlign} onChange={(v) => up({ vAlign: v })} options={[{ value: 'top', label: '⤒', title: '위' }, { value: 'middle', label: '⇕', title: '가운데' }, { value: 'bottom', label: '⤓', title: '아래' }]} />
        </Row>
        <Row label="글자색"><Color value={o.color} onChange={(c) => up({ color: c })} /></Row>
        <Row label="칸 배경"><Color value={o.fill} allowNone onChange={(c) => up({ fill: c })} /></Row>
        <Row>
          <Check label="첫 행 머리글" checked={o.headerRow} onChange={(v) => up({ headerRow: v })} />
          <Check label="첫 열 머리글" checked={o.headerCol} onChange={(v) => up({ headerCol: v })} />
        </Row>
        {(o.headerRow || o.headerCol) && (
          <>
            <Row label="머리글 배경"><Color value={o.headerFill} allowNone onChange={(c) => up({ headerFill: c })} /></Row>
            <Row label="머리글 글자"><Color value={o.headerColor} onChange={(c) => up({ headerColor: c })} /></Row>
          </>
        )}
        <Row label="선 색"><Color value={o.borderColor} onChange={(c) => up({ borderColor: c })} /></Row>
        <div className="grid2">
          <Num label="안쪽 선" value={o.borderWidth} step={0.05} min={0} unit="mm" onChange={(v) => up({ borderWidth: v })} />
          <Num label="바깥 선" value={o.outerWidth} step={0.05} min={0} unit="mm" onChange={(v) => up({ outerWidth: v })} />
        </div>
      </Section>
    </>
  );
}
