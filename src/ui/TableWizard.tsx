import { useMemo, useState } from 'react';
import { newObject } from '../model/defaults';
import {
  blankLayout, blockMinutes, DEFAULT_BLOCKS, fmtTime, parseTime, programLayout, WEEKDAYS, weeklyLayout,
  type BlockKind, type ProgramBlock, type TableLayout,
} from '../model/tableLayouts';
import type { LabelObject, TableObj } from '../model/types';
import { previewCtx } from '../render/resolve';
import { labelMarkup } from '../render/svg';
import { act, currentObjects, useStore } from '../store';
import { Check, Color, Modal, Num, Seg } from './controls';

/** Where the new table goes (drawn on the canvas), or the table whose layout is replaced. */
export interface TableWizardArg { id?: string; x?: number; y?: number; w?: number; h?: number }

type Kind = 'weekly' | 'program' | 'blank';

const KINDS: { value: Kind; label: string; desc: string }[] = [
  { value: 'weekly', label: '요일 × 교시', desc: '학교·학원 시간표. 가로는 요일, 세로는 교시' },
  { value: 'program', label: '학술대회 시간표', desc: '실제 시각으로 나눈 세션, 커피 브레이크·점심이 표 전체를 가로지름' },
  { value: 'blank', label: '빈 표', desc: '행과 열 수만 정해서 시작' },
];

const DAY_SETS: { value: string; label: string; days: string[] }[] = [
  { value: '5', label: '월–금', days: WEEKDAYS.slice(0, 5) },
  { value: '6', label: '월–토', days: WEEKDAYS.slice(0, 6) },
  { value: '7', label: '월–일', days: WEEKDAYS },
];

const KIND_LABEL: { value: BlockKind; label: string; title: string }[] = [
  { value: 'session', label: '세션', title: '트랙(방·날짜)마다 따로 채우는 칸' },
  { value: 'plenary', label: '전체', title: '모든 트랙을 가로지르는 한 칸 (기조강연, 개회식)' },
  { value: 'break', label: '휴식', title: '모든 트랙을 가로지르는 회색 칸 (커피 브레이크, 점심)' },
];

export function TableWizard() {
  const arg = (useStore((s) => s.dialogArg) ?? {}) as TableWizardArg;
  const project = useStore((s) => s.project);
  const { close } = useStore.getState();
  const existing = arg.id
    ? currentObjects(useStore.getState()).find((o): o is TableObj => o.id === arg.id && o.type === 'table')
    : undefined;

  const [kind, setKind] = useState<Kind>('weekly');
  const [week, setWeek] = useState({ daySet: '5', periods: 7, showTimes: true, start: '09:00', lesson: 50, rest: 10, lunchAfter: 4, lunch: 60 });
  const [prog, setProg] = useState({ tracks: 'Room A, Room B', blocks: DEFAULT_BLOCKS, proportional: true, breakFill: '#e5e7eb' });
  const [blank, setBlank] = useState({ rows: 4, cols: 4, headerRow: true, headerCol: false });

  const layout: TableLayout = useMemo(() => {
    if (kind === 'weekly') {
      return weeklyLayout({ ...week, days: DAY_SETS.find((d) => d.value === week.daySet)!.days });
    }
    if (kind === 'program') {
      const tracks = prog.tracks.split(',').map((t) => t.trim()).filter(Boolean);
      return programLayout({ tracks, blocks: prog.blocks, proportional: prog.proportional, breakFill: prog.breakFill });
    }
    return blankLayout(blank.rows, blank.cols, blank.headerRow, blank.headerCol);
  }, [kind, week, prog, blank]);

  // size: what was drawn, the table being replaced, or a default that fits on the label
  const paper = project.paper;
  const M = 2;
  const defW = kind === 'program' ? 90 : kind === 'weekly' ? 80 : 60;
  const defH = kind === 'blank' ? 30 : 70;
  const w = existing?.w ?? arg.w ?? Math.max(5, Math.min(defW, paper.labelWidth - 2 * M));
  const h = existing?.h ?? arg.h ?? Math.max(5, Math.min(defH, paper.labelHeight - 2 * M));
  // a click near the edge moves the default-sized table back onto the label
  const x = existing?.x ?? (arg.w ? arg.x! : Math.max(0, Math.min(arg.x ?? M, paper.labelWidth - M - w)));
  const y = existing?.y ?? (arg.h ? arg.y! : Math.max(0, Math.min(arg.y ?? M, paper.labelHeight - M - h)));
  // a new table's text starts at a size its rows can hold (two lines for times)
  const fonts = useMemo(() => {
    if (existing) return {};
    const lines = Math.max(...layout.cells.flat().map((v) => v.split('\n').length), 1);
    const rowMm = h / layout.cells.length;
    const fontSize = Math.round(Math.max(2.5, Math.min(9, (rowMm * 0.7) / lines / 0.3528)) * 2) / 2;
    return { fontSize, minFontSize: Math.max(1.5, Math.min(4, Math.round(fontSize * 6) / 10)) };
  }, [existing, layout, h]);

  const obj = useMemo(() => {
    const base = existing ?? (newObject('table', 0, 0, w, h) as TableObj);
    return { ...base, ...layout, ...fonts, x: 0, y: 0, w, h, rotation: 0 } as TableObj;
  }, [existing, layout, fonts, w, h]);
  const preview = useMemo(() => {
    const inner = labelMarkup(project, [obj], previewCtx(undefined, 0, project.seqStart), { paperBg: false, idp: 'tw' });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}"><rect width="${w}" height="${h}" fill="#fff"/>${inner}</svg>`;
  }, [project, obj, w, h]);

  const create = () => {
    if (existing) {
      act.update([existing.id], layout as Partial<LabelObject>);
    } else {
      act.add('table', x, y, w, h, { ...layout, ...fonts } as Partial<LabelObject>);
    }
    close();
  };

  const setBlock = (i: number, p: Partial<ProgramBlock>) => setProg((s) => ({ ...s, blocks: s.blocks.map((b, j) => (j === i ? { ...b, ...p } : b)) }));
  const addBlock = () => setProg((s) => {
    const last = s.blocks[s.blocks.length - 1];
    const t = last ? parseTime(last.end) : 9 * 60;
    const start = fmtTime(Number.isFinite(t) ? t : 9 * 60);
    return { ...s, blocks: [...s.blocks, { start, end: fmtTime(parseTime(start) + 90), kind: 'session', title: `Session ${s.blocks.filter((b) => b.kind === 'session').length + 1}` }] };
  });
  const badTime = (b: ProgramBlock) => !Number.isFinite(parseTime(b.start)) || !Number.isFinite(parseTime(b.end)) || parseTime(b.end) <= parseTime(b.start);

  return (
    <Modal title={existing ? '표 형식 바꾸기' : '표 만들기'} onClose={close} wide
      footer={<>
        {existing && <span className="muted small">지금 표의 내용은 새 형식으로 바뀝니다 (Ctrl+Z로 되돌리기)</span>}
        <span className="spacer" />
        <button onClick={close}>취소</button>
        <button className="primary" onClick={create}>{existing ? '바꾸기' : '만들기'}</button>
      </>}>
      <div className="tw-kinds">
        {KINDS.map((k) => (
          <button key={k.value} className={`card ${kind === k.value ? 'on' : ''}`} onClick={() => setKind(k.value)}>
            <strong>{k.label}</strong>
            <span className="muted small">{k.desc}</span>
          </button>
        ))}
      </div>
      <div className="tw-body">
        <div className="tw-form">
          {kind === 'weekly' && (
            <>
              <div className="row"><span className="row-label">요일</span>
                <Seg value={week.daySet} onChange={(v) => setWeek({ ...week, daySet: v })} options={DAY_SETS.map((d) => ({ value: d.value, label: d.label }))} />
              </div>
              <div className="grid2">
                <Num label="교시 수" value={week.periods} step={1} min={1} max={15} onChange={(v) => setWeek({ ...week, periods: Math.round(v) })} />
                <Num label="점심" title="몇 교시 뒤에 점심시간 행을 넣을지 (0 = 넣지 않음)" value={week.lunchAfter} step={1} min={0} max={week.periods} unit="교시 뒤"
                  onChange={(v) => setWeek({ ...week, lunchAfter: Math.round(v) })} />
              </div>
              <Check label="교시 옆에 시각 표시" checked={week.showTimes} onChange={(v) => setWeek({ ...week, showTimes: v })} />
              {week.showTimes && (
                <div className="grid2">
                  <label className="num"><span className="num-label">시작</span>
                    <input value={week.start} onChange={(e) => setWeek({ ...week, start: e.target.value })} placeholder="09:00" />
                  </label>
                  <Num label="수업" value={week.lesson} step={5} min={5} unit="분" onChange={(v) => setWeek({ ...week, lesson: v })} />
                  <Num label="쉬는 시간" value={week.rest} step={5} min={0} unit="분" onChange={(v) => setWeek({ ...week, rest: v })} />
                  {week.lunchAfter > 0 && <Num label="점심" value={week.lunch} step={5} min={5} unit="분" onChange={(v) => setWeek({ ...week, lunch: v })} />}
                </div>
              )}
            </>
          )}

          {kind === 'program' && (
            <>
              <label className="tw-field">
                <span>트랙 (쉼표로 구분 · 방이나 날짜)</span>
                <input value={prog.tracks} onChange={(e) => setProg({ ...prog, tracks: e.target.value })} placeholder="Room A, Room B  또는  Day 1, Day 2" />
              </label>
              <table className="tw-blocks">
                <thead><tr><th>시작</th><th>끝</th><th>종류</th><th>이름</th><th /></tr></thead>
                <tbody>
                  {prog.blocks.map((b, i) => (
                    <tr key={i} className={badTime(b) ? 'bad' : ''}>
                      <td><input value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} /></td>
                      <td><input value={b.end} onChange={(e) => setBlock(i, { end: e.target.value })} title={`${blockMinutes(b)}분`} /></td>
                      <td>
                        <select value={b.kind} onChange={(e) => setBlock(i, { kind: e.target.value as BlockKind })} title={KIND_LABEL.find((k) => k.value === b.kind)?.title}>
                          {KIND_LABEL.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                      </td>
                      <td><input value={b.title} onChange={(e) => setBlock(i, { title: e.target.value })} /></td>
                      <td><button className="icon small" title="이 블록 삭제" disabled={prog.blocks.length <= 1}
                        onClick={() => setProg({ ...prog, blocks: prog.blocks.filter((_, j) => j !== i) })}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="btn-row">
                <button onClick={addBlock}>＋ 블록 추가</button>
                <button onClick={() => setProg({ ...prog, blocks: DEFAULT_BLOCKS })} title="09:00–15:30, 커피 브레이크·점심 포함">기본값</button>
              </div>
              <p className="muted small">세션: 트랙마다 따로 채움 · 전체: 기조강연처럼 모든 트랙을 한 칸으로 · 휴식: 커피 브레이크·점심 (회색)</p>
              <Check label="시간 길이에 맞춰 행 높이 정하기" title="90분 세션은 30분 휴식보다 3배 높게" checked={prog.proportional} onChange={(v) => setProg({ ...prog, proportional: v })} />
              <div className="row"><span className="row-label">휴식 칸</span><Color value={prog.breakFill} onChange={(c) => setProg({ ...prog, breakFill: c })} /></div>
            </>
          )}

          {kind === 'blank' && (
            <>
              <div className="grid2">
                <Num label="행" value={blank.rows} step={1} min={1} max={60} onChange={(v) => setBlank({ ...blank, rows: Math.round(v) })} />
                <Num label="열" value={blank.cols} step={1} min={1} max={30} onChange={(v) => setBlank({ ...blank, cols: Math.round(v) })} />
              </div>
              <div className="row">
                <Check label="첫 행 머리글" checked={blank.headerRow} onChange={(v) => setBlank({ ...blank, headerRow: v })} />
                <Check label="첫 열 머리글" checked={blank.headerCol} onChange={(v) => setBlank({ ...blank, headerCol: v })} />
              </div>
            </>
          )}
          <p className="muted small">만든 뒤에는 캔버스에서 표를 더블클릭해 칸에 바로 입력합니다.</p>
        </div>
        <div className="tw-preview">
          <div className="thumb" dangerouslySetInnerHTML={{ __html: preview }} />
          <span className="muted small">{layout.cells.length}행 × {layout.cells[0]?.length ?? 0}열 · {Math.round(w * 10) / 10}×{Math.round(h * 10) / 10} mm</span>
        </div>
      </div>
    </Modal>
  );
}
