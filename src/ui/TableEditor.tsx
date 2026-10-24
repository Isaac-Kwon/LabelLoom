import { cellKey, tableSize } from '../model/table';
import type { LabelObject, TableCellStyle, TableObj } from '../model/types';
import { act, useStore } from '../store';
import { Check, Color, Num, Row, Section, Seg } from './controls';
import { editTable, selRange, styleSel, tableCommands } from './TableCanvas';

const quoteFamily = (f: string) => (/^[\w-]+$/.test(f) ? f : `"${f}"`);
const primaryFamily = (css: string) => css.split(',')[0].trim().replace(/^["']|["']$/g, '');

export function TableSection({ o }: { o: TableObj }) {
  const columns = useStore((s) => s.project.data.columns);
  const cellSel = useStore((s) => s.cellSel);
  const up = (p: Partial<TableObj>) => act.update([o.id], p as Partial<LabelObject>);
  const { rows, cols } = tableSize(o);
  const sel = cellSel?.id === o.id ? cellSel : null;
  const { a, g } = selRange(o, sel);
  const count = (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
  const st = o.styles[cellKey(a.r, a.c)] ?? {};
  const styleRange = (patch: Partial<TableCellStyle>) => styleSel(o, sel, patch);
  const setCell = (v: string) => up({ cells: o.cells.map((row, i) => (i === a.r ? row.map((x, j) => (j === a.c ? v : x)) : row)) });

  return (
    <>
      <Section title={`표 · ${rows}행 × ${cols}열`}>
        {sel ? (
          <p className="note">칸을 클릭하고 바로 입력하세요. 끌거나 Shift+클릭으로 여러 칸, 오른쪽 클릭으로 행·열 메뉴, 칸 사이 선을 끌면 크기 조절 · Esc로 끝내기</p>
        ) : (
          <button className="primary" disabled={o.locked} onClick={() => editTable(o)}>칸 편집하기</button>
        )}
        <p className="muted small">캔버스에서 표를 더블클릭해도 칸 편집이 시작됩니다. 엑셀에서 복사한 표는 칸을 고르고 Ctrl+V로 붙여넣습니다.</p>
        <div className="btn-row">
          <button onClick={() => useStore.getState().open('table', { id: o.id })} title="요일×교시, 학술대회 시간표, 빈 표 중에서 다시 고릅니다">표 형식 바꾸기…</button>
          <button onClick={() => up({ colWidths: Array(cols).fill(1) })}>열 너비 같게</button>
          <button onClick={() => up({ rowHeights: Array(rows).fill(1) })}>행 높이 같게</button>
        </div>
      </Section>

      {sel && (
        <Section title={count > 1 ? `선택한 칸 (${count}칸)` : `선택한 칸 (${a.r + 1}행 ${a.c + 1}열)`}>
          <div className="cmd-grid">
            {tableCommands(o, sel).map((c) => (
              <button key={c.key} disabled={c.disabled} title={c.title} onClick={c.run}>{c.label}</button>
            ))}
          </div>
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
            <Num label="열 너비" title={`${a.c + 1}열의 상대 너비 (다른 열과의 비율). 캔버스에서 칸 사이 선을 끌어도 됩니다`} value={o.colWidths[a.c] ?? 1} step={0.1} min={0.05}
              onChange={(v) => up({ colWidths: Array.from({ length: cols }, (_, i) => (i === a.c ? v : o.colWidths[i] ?? 1)) })} />
            <Num label="행 높이" title={`${a.r + 1}행의 상대 높이 (다른 행과의 비율)`} value={o.rowHeights[a.r] ?? 1} step={0.1} min={0.05}
              onChange={(v) => up({ rowHeights: Array.from({ length: rows }, (_, i) => (i === a.r ? v : o.rowHeights[i] ?? 1)) })} />
          </div>
          {columns.length > 0 && (
            <select value="" title="선택한 칸에 데이터 열 넣기" onChange={(e) => e.target.value && setCell((o.cells[a.r][a.c] ?? '') + `{{${e.target.value}}}`)}>
              <option value="">+ 데이터 열 넣기</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Section>
      )}

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
