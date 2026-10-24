import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  cellRange, clearRange, deleteCols, deleteRows, insertCol, insertRow, mergeAt, mergeCells, moveLine, pasteGrid,
  rangeText, styleCells, tableGeometry, tableSize, unmergeRange, validMerges, type CellRange,
} from '../model/table';
import type { LabelObject, TableCellStyle, TableObj } from '../model/types';
import { act, useStore, type CellSel } from '../store';

/* ---------- shared by the canvas overlay and the inspector ---------- */

const rot = (x: number, y: number, deg: number) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

/** The cell under a point given in label mm, as the origin of its merge. */
export function tableCellAt(o: TableObj, m: { x: number; y: number }) {
  const { rows, cols, xs, ys } = tableGeometry(o);
  const l = rot(m.x - o.x - o.w / 2, m.y - o.y - o.h / 2, -o.rotation);
  const lx = l.x + o.w / 2, ly = l.y + o.h / 2;
  let c = 0, r = 0;
  while (c < cols - 1 && lx >= xs[c + 1]) c++;
  while (r < rows - 1 && ly >= ys[r + 1]) r++;
  const mg = mergeAt(o, r, c);
  return mg ? { r: mg.r, c: mg.c } : { r, c };
}

/** Start editing a table's cells on the canvas. */
export function editTable(o: TableObj, at = { r: 0, c: 0 }) {
  const s = useStore.getState();
  s.select([o.id]);
  s.setCellSel({ id: o.id, r: at.r, c: at.c, ar: at.r, ac: at.c });
}

/** The selection clamped to the table as it is now (rows may have been removed by undo). */
export function selRange(o: TableObj, sel: CellSel | null): { a: { r: number; c: number }; g: CellRange } {
  const { rows, cols } = tableSize(o);
  const cl = (r: number, c: number) => ({ r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) });
  const a = cl(sel?.r ?? 0, sel?.c ?? 0), b = cl(sel?.ar ?? a.r, sel?.ac ?? a.c);
  return { a, g: cellRange(o, a, b) };
}

export interface TableCommand { key: string; label: ReactNode; title: string; disabled?: boolean; run: () => void; sep?: boolean }

/** Row, column, merge and clear actions for the selected cells. */
export function tableCommands(o: TableObj, sel: CellSel | null): TableCommand[] {
  const { rows, cols } = tableSize(o);
  const { a, g } = selRange(o, sel);
  const nr = g.r1 - g.r0 + 1, nc = g.c1 - g.c0 + 1;
  const to = (r: number, c: number, ar = r, ac = c) => useStore.getState().setCellSel({ id: o.id, r, c, ar, ac });
  const apply = (p: Partial<TableObj> | null, after: () => void) => { if (p) { act.update([o.id], p as Partial<LabelObject>); after(); } };
  const merged = validMerges(o).some((m) => m.r <= g.r1 && m.r + m.rs - 1 >= g.r0 && m.c <= g.c1 && m.c + m.cs - 1 >= g.c0);
  return [
    { key: 'rowAbove', label: '위에 행 넣기', title: '선택한 칸 위에 빈 행', run: () => apply(insertRow(o, g.r0), () => to(g.r0, a.c)) },
    { key: 'rowBelow', label: '아래에 행 넣기', title: '선택한 칸 아래에 빈 행', run: () => apply(insertRow(o, g.r1 + 1), () => to(g.r1 + 1, a.c)) },
    { key: 'colLeft', label: '왼쪽에 열 넣기', title: '선택한 칸 왼쪽에 빈 열', run: () => apply(insertCol(o, g.c0), () => to(a.r, g.c0)) },
    { key: 'colRight', label: '오른쪽에 열 넣기', title: '선택한 칸 오른쪽에 빈 열', run: () => apply(insertCol(o, g.c1 + 1), () => to(a.r, g.c1 + 1)) },
    {
      key: 'delRows', label: nr > 1 ? `행 ${nr}개 삭제` : '행 삭제', title: '선택한 칸이 있는 행을 지웁니다', sep: true, disabled: nr >= rows,
      run: () => apply(deleteRows(o, g.r0, g.r1), () => to(Math.min(g.r0, rows - nr - 1), a.c)),
    },
    {
      key: 'delCols', label: nc > 1 ? `열 ${nc}개 삭제` : '열 삭제', title: '선택한 칸이 있는 열을 지웁니다', disabled: nc >= cols,
      run: () => apply(deleteCols(o, g.c0, g.c1), () => to(a.r, Math.min(g.c0, cols - nc - 1))),
    },
    {
      key: 'merge', label: '칸 합치기', title: '고른 칸들을 한 칸으로 (예: 2시간 연속 수업, 휴식 시간)', sep: true, disabled: nr * nc < 2,
      run: () => apply(mergeCells(o, { r: g.r0, c: g.c0 }, { r: g.r1, c: g.c1 }), () => to(g.r0, g.c0)),
    },
    { key: 'unmerge', label: '합친 칸 나누기', title: '합친 칸을 원래 칸으로', disabled: !merged, run: () => apply(unmergeRange(o, g), () => to(g.r0, g.c0, g.r1, g.c1)) },
    { key: 'clear', label: '내용 지우기', title: '선택한 칸의 글자를 지웁니다 (Delete)', sep: true, run: () => apply(clearRange(o, g), () => undefined) },
  ];
}

export const styleSel = (o: TableObj, sel: CellSel | null, patch: Partial<TableCellStyle>) =>
  act.update([o.id], styleCells(o, selRange(o, sel).g, patch) as Partial<LabelObject>);

/* ---------- the overlay ---------- */

type Drag =
  | { kind: 'cells'; moved: boolean; again: boolean }
  | { kind: 'col' | 'row'; i: number; sizes: number[]; started: boolean };

const SWATCHES = ['', '#e8eefc', '#fef3c7', '#dcfce7', '#fee2e2', '#f3e8ff', '#e5e7eb'];

/**
 * Edits a table in place like a spreadsheet: click or drag to pick cells, type to fill them,
 * drag a grid line to resize, right-click for rows, columns and merging.
 */
export function TableOverlay({ o, pan, zoom, size, toMm }: {
  o: TableObj; pan: { x: number; y: number }; zoom: number; size: { w: number; h: number };
  toMm: (e: { clientX: number; clientY: number }) => { x: number; y: number };
}) {
  const sel = useStore((s) => s.cellSel);
  const { rows, cols, xs, ys } = tableGeometry(o);
  const { a, g } = selRange(o, sel);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const s = useStore.getState();

  const span = mergeAt(o, a.r, a.c);
  const ar = { x: xs[a.c], y: ys[a.r], w: xs[a.c + (span?.cs ?? 1)] - xs[a.c], h: ys[a.r + (span?.rs ?? 1)] - ys[a.r] };
  const text = o.cells[a.r]?.[a.c] ?? '';

  const focus = () => ta.current?.focus({ preventScroll: true });
  useEffect(() => { focus(); }, []);
  // moving to another cell ends the edit of the previous one
  useEffect(() => { setEditing(false); started.current = false; }, [a.r, a.c]);
  useLayoutEffect(() => {
    if (!editing || !ta.current) return;
    const el = ta.current;
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const to = (r: number, c: number, extend = false) => {
    const t = { r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
    const mg = mergeAt(o, t.r, t.c);
    const p = mg ? { r: mg.r, c: mg.c } : t;
    s.setCellSel(extend && sel ? { ...sel, r: p.r, c: p.c } : { id: o.id, r: p.r, c: p.c, ar: p.r, ac: p.c });
  };
  /** One step in a direction, jumping over the rest of a merged cell. */
  const step = (dr: number, dc: number, extend: boolean) => {
    const cur = extend && sel ? { r: sel.r, c: sel.c } : a;
    const mg = mergeAt(o, cur.r, cur.c);
    const r = dr > 0 ? (mg ? mg.r + mg.rs : cur.r + 1) : dr < 0 ? cur.r - 1 : cur.r;
    const c = dc > 0 ? (mg ? mg.c + mg.cs : cur.c + 1) : dc < 0 ? cur.c - 1 : cur.c;
    to(r, c, extend);
  };
  const next = () => {
    const mg = mergeAt(o, a.r, a.c);
    const c = mg ? mg.c + mg.cs : a.c + 1;
    if (c < cols) to(a.r, c);
    else if (a.r + (mg?.rs ?? 1) < rows) to(a.r + (mg?.rs ?? 1), 0);
    else { act.update([o.id], insertRow(o, rows) as Partial<LabelObject>); s.setCellSel({ id: o.id, r: rows, c: 0, ar: rows, ac: 0 }); }
  };
  const prev = () => (a.c > 0 ? to(a.r, a.c - 1) : a.r > 0 ? to(a.r - 1, cols - 1) : undefined);

  const setText = (v: string) => {
    if (!started.current) { s.checkpoint(); started.current = true; }
    act.update([o.id], { cells: o.cells.map((row, r) => (r === a.r ? row.map((x, c) => (c === a.c ? v : x)) : row)) } as Partial<LabelObject>, true);
  };
  const beginEdit = () => { setEditing(true); started.current = false; focus(); };
  const endEdit = () => { setEditing(false); started.current = false; };
  const cancelEdit = () => { if (started.current) s.undo(); endEdit(); };
  const exit = () => s.setCellSel(null);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    const mod = e.ctrlKey || e.metaKey;
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); insertAtCaret('\n'); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endEdit(); step(1, 0, false); }
      else if (e.key === 'Tab') { e.preventDefault(); endEdit(); if (e.shiftKey) prev(); else next(); }
      return;
    }
    const k = e.key;
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (lk === 'y') { e.preventDefault(); s.redo(); }
      else if (lk === 'a') { e.preventDefault(); s.setCellSel({ id: o.id, r: 0, c: 0, ar: rows - 1, ac: cols - 1 }); }
      else if (lk === 'b') { e.preventDefault(); styleSel(o, sel, { bold: !(o.styles[`${a.r},${a.c}`]?.bold ?? false) }); }
      return; // copy, cut and paste arrive as clipboard events
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) { e.preventDefault(); step(moves[k][0], moves[k][1], e.shiftKey); }
    else if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) prev(); else next(); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); beginEdit(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); act.update([o.id], clearRange(o, g) as Partial<LabelObject>); }
    else if (k === 'Escape') { e.preventDefault(); exit(); }
    else if (k === 'Home') { e.preventDefault(); to(a.r, 0, e.shiftKey); }
    else if (k === 'End') { e.preventDefault(); to(a.r, cols - 1, e.shiftKey); }
  };
  const insertAtCaret = (str: string) => {
    const el = ta.current!;
    const v = el.value.slice(0, el.selectionStart) + str + el.value.slice(el.selectionEnd);
    const pos = el.selectionStart + str.length;
    setText(v);
    requestAnimationFrame(() => el.setSelectionRange(pos, pos));
  };

  /* ---------- pointer ---------- */
  const cellOf = (e: React.PointerEvent | React.MouseEvent) => tableCellAt(o, toMm(e));
  const inRange = (p: { r: number; c: number }) => p.r >= g.r0 && p.r <= g.r1 && p.c >= g.c0 && p.c <= g.c1;

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button === 1) return;
    e.preventDefault();
    setMenu(null);
    const p = cellOf(e);
    if (e.button === 2) {
      if (!inRange(p)) to(p.r, p.c);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const again = !e.shiftKey && p.r === a.r && p.c === a.c && g.r0 === g.r1 && g.c0 === g.c1 && !editing;
    if (editing && (p.r !== a.r || p.c !== a.c)) endEdit();
    if (!(editing && p.r === a.r && p.c === a.c)) to(p.r, p.c, e.shiftKey);
    setDrag({ kind: 'cells', moved: false, again });
    focus();
  };
  const onGripDown = (e: React.PointerEvent, kind: 'col' | 'row', i: number) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const lines = kind === 'col' ? xs : ys;
    setDrag({ kind, i, sizes: lines.slice(1).map((v, j) => v - lines[j]), started: false });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'cells') {
      if (editing) return;
      const p = cellOf(e);
      const end = sel ? { r: sel.r, c: sel.c } : a;
      if (p.r === end.r && p.c === end.c) return;
      // dragging keeps the cell it started on as the anchor
      s.setCellSel({ id: o.id, r: p.r, c: p.c, ar: sel?.ar ?? a.r, ac: sel?.ac ?? a.c });
      if (!drag.moved) setDrag({ ...drag, moved: true });
      return;
    }
    const m = toMm(e);
    const l = rot(m.x - o.x - o.w / 2, m.y - o.y - o.h / 2, -o.rotation);
    const at = drag.kind === 'col' ? l.x + o.w / 2 : l.y + o.h / 2;
    if (!drag.started) { s.checkpoint(); setDrag({ ...drag, started: true }); }
    const weights = moveLine(drag.sizes, drag.i, at, 1);
    act.update([o.id], (drag.kind === 'col' ? { colWidths: weights } : { rowHeights: weights }) as Partial<LabelObject>, true);
  };
  const onUp = () => {
    if (drag?.kind === 'cells' && drag.again && !drag.moved) beginEdit();
    setDrag(null);
  };

  /* ---------- clipboard ---------- */
  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeText(o, g));
    if (cut) act.update([o.id], clearRange(o, g) as Partial<LabelObject>);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData('text/plain');
    if (editing && !/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    endEdit();
    act.update([o.id], pasteGrid(o, t, g.r0, g.c0) as Partial<LabelObject>);
  };

  /* ---------- layout ---------- */
  const z = zoom;
  const box = (x: number, y: number, w: number, h: number) => ({ left: x * z, top: y * z, width: w * z, height: h * z });
  const fontPx = Math.max(12, Math.min(26, o.fontSize * 0.3528 * z));
  const cmds = tableCommands(o, sel);
  const run = (key: string) => { cmds.find((c) => c.key === key)?.run(); setMenu(null); focus(); };
  const st = o.styles[`${a.r},${a.c}`] ?? {};
  const head = (o.headerRow && a.r === 0) || (o.headerCol && a.c === 0);

  // the floating bar sits above the table's screen bounds, or below when there is no room
  const corners = [[0, 0], [o.w, 0], [0, o.h], [o.w, o.h]].map(([x, y]) => {
    const p = rot(x - o.w / 2, y - o.h / 2, o.rotation);
    return { x: pan.x + (o.x + o.w / 2 + p.x) * z, y: pan.y + (o.y + o.h / 2 + p.y) * z };
  });
  const minX = Math.min(...corners.map((p) => p.x)), minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  const barTop = minY - 44 >= 4 ? minY - 44 : Math.min(maxY + 22, size.h - 44);
  const barLeft = Math.max(4, Math.min(minX, size.w - 640));

  return (
    <>
      <div className="tbl-overlay" style={{
        left: pan.x + o.x * z, top: pan.y + o.y * z, width: o.w * z, height: o.h * z,
        transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
      }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onMouseDown={(e) => { if (!(editing && e.target === ta.current)) e.preventDefault(); }}
        onDoubleClick={(e) => { e.stopPropagation(); beginEdit(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}>
        <div className="tbl-range" style={box(xs[g.c0], ys[g.r0], xs[g.c1 + 1] - xs[g.c0], ys[g.r1 + 1] - ys[g.r0])} />
        {xs.slice(1, -1).map((x, i) => (
          <div key={'c' + i} className="tbl-grip col" style={{ left: x * z - 4, height: o.h * z }} title="끌어서 열 너비 조절"
            onPointerDown={(e) => onGripDown(e, 'col', i + 1)} />
        ))}
        {ys.slice(1, -1).map((y, i) => (
          <div key={'r' + i} className="tbl-grip row" style={{ top: y * z - 4, width: o.w * z }} title="끌어서 행 높이 조절"
            onPointerDown={(e) => onGripDown(e, 'row', i + 1)} />
        ))}
        <textarea ref={ta} className={`tbl-input ${editing ? 'on' : ''}`} spellCheck={false}
          style={{
            ...box(ar.x, ar.y, ar.w, ar.h), fontSize: fontPx,
            fontWeight: st.bold ?? head ? 700 : 400,
            textAlign: st.align ?? o.align,
            background: editing ? '#fff' : undefined,
          }}
          value={editing ? text : ''}
          onChange={(e) => { if (!editing) setEditing(true); setText(e.target.value); }}
          onKeyDown={onKey} onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}
          onPointerDown={(e) => { if (editing) e.stopPropagation(); }} />
        <button className="tbl-add col" title="오른쪽 끝에 열 추가" style={{ left: o.w * z + 6, top: o.h * z / 2 - 11 }}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => { act.update([o.id], insertCol(o, cols) as Partial<LabelObject>); to(a.r, cols); focus(); }}>＋</button>
        <button className="tbl-add row" title="아래 끝에 행 추가" style={{ left: o.w * z / 2 - 11, top: o.h * z + 6 }}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => { act.update([o.id], insertRow(o, rows) as Partial<LabelObject>); to(rows, a.c); focus(); }}>＋</button>
      </div>

      <div className="tbl-bar" style={{ left: barLeft, top: barTop }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}>
        <span className="tbl-bar-pos">{g.r0 === g.r1 && g.c0 === g.c1 ? `${a.r + 1}행 ${a.c + 1}열` : `${g.r1 - g.r0 + 1}×${g.c1 - g.c0 + 1}칸`}</span>
        <BarBtn c={cmds} k="rowAbove" text="＋행 위" run={run} />
        <BarBtn c={cmds} k="rowBelow" text="＋행 아래" run={run} />
        <BarBtn c={cmds} k="colLeft" text="＋열 왼쪽" run={run} />
        <BarBtn c={cmds} k="colRight" text="＋열 오른쪽" run={run} />
        <BarBtn c={cmds} k="delRows" text="−행" run={run} />
        <BarBtn c={cmds} k="delCols" text="−열" run={run} />
        <i />
        <BarBtn c={cmds} k="merge" text="합치기" run={run} />
        <BarBtn c={cmds} k="unmerge" text="나누기" run={run} />
        <i />
        <button className={st.bold ?? head ? 'on' : ''} title="굵게 (Ctrl+B)" onClick={() => { styleSel(o, sel, { bold: !(st.bold ?? head) }); focus(); }}><b>B</b></button>
        {(['left', 'center', 'right'] as const).map((al) => (
          <button key={al} className={(st.align ?? o.align) === al ? 'on' : ''} title={{ left: '왼쪽 정렬', center: '가운데 정렬', right: '오른쪽 정렬' }[al]}
            onClick={() => { styleSel(o, sel, { align: al === o.align ? undefined : al }); focus(); }}>{{ left: '⇤', center: '↔', right: '⇥' }[al]}</button>
        ))}
        <i />
        {SWATCHES.map((c) => (
          <button key={c || 'none'} className={`swatch ${(st.fill ?? '') === c ? 'on' : ''}`} title={c ? `칸 배경 ${c}` : '칸 배경 기본값'}
            style={{ background: c || undefined }} onClick={() => { styleSel(o, sel, { fill: c || undefined }); focus(); }}>{c ? '' : '∅'}</button>
        ))}
        <i />
        <button onClick={exit} title="표 편집 끝내기 (Esc)">완료</button>
      </div>

      {menu && (
        <>
          <div className="ctx-back" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 330) }}
            onMouseDown={(e) => e.preventDefault()}>
            {cmds.map((c) => (
              <div key={c.key}>
                {c.sep && <hr />}
                <button disabled={c.disabled} title={c.title} onClick={() => run(c.key)}>{c.label}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BarBtn({ c, k, text, run }: { c: TableCommand[]; k: string; text: string; run: (k: string) => void }) {
  const cmd = c.find((x) => x.key === k)!;
  return <button disabled={cmd.disabled} title={`${cmd.label} — ${cmd.title}`} onClick={() => run(k)}>{text}</button>;
}
