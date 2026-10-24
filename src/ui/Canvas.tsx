import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newRow } from '../model/defaults';
import type { BarcodeObj, LabelObject, QrObj, TextObj } from '../model/types';
import { preprintArea, preprintMarkup } from '../render/preprint';
import { previewCtx, templateColumns } from '../render/resolve';
import { labelMarkup, objTransform } from '../render/svg';
import { act, currentObjects, expandGroups, useStore } from '../store';
import { pickImageInto } from './media';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Drag =
  | { kind: 'move'; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; started: boolean }
  | { kind: 'resize'; handle: Handle; sx: number; sy: number; orig: LabelObject; started: boolean }
  | { kind: 'rotate'; orig: LabelObject; started: boolean }
  | { kind: 'marquee'; sx: number; sy: number; x: number; y: number; additive: boolean }
  | { kind: 'pan'; cx: number; cy: number; px: number; py: number }
  | { kind: 'create'; sx: number; sy: number; x: number; y: number };

const HANDLES: { h: Handle; fx: number; fy: number; cursor: string }[] = [
  { h: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' }, { h: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { h: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' }, { h: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { h: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' }, { h: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { h: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' }, { h: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

const rot = (x: number, y: number, deg: number) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

export function Canvas() {
  const project = useStore((s) => s.project);
  const designId = useStore((s) => s.designId);
  const side = useStore((s) => s.side);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const currentRow = useStore((s) => s.currentRow);
  const objects = currentObjects({ project, designId, side });
  const paper = project.paper;
  const LW = paper.labelWidth, LH = paper.labelHeight;
  const bl = Math.max(0, paper.bleed);

  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [space, setSpace] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const editObj = editing ? objects.find((o): o is ContentObj => o.id === editing && 'content' in o) : undefined;

  // the inline editor follows the selection: selecting something else closes it
  useEffect(() => { if (editing && !(selection.length === 1 && selection[0] === editing)) setEditing(null); }, [selection, editing]);

  // Enter / F2 edits the selected object in place
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== 'F2') || isTyping() || useStore.getState().dialog) return;
      const s = useStore.getState();
      const o = currentObjects(s).find((x) => s.selection.length === 1 && x.id === s.selection[0]);
      if (o && 'content' in o && !o.locked) { e.preventDefault(); setEditing(o.id); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const row = project.data.rows[currentRow];
  const markup = useMemo(
    () => labelMarkup(project, objects, previewCtx(row, currentRow, project.seqStart), { editor: true, idp: 'ed' }),
    [project, objects, row, currentRow],
  );
  const preprint = useMemo(() => (paper.preprint?.show ? preprintMarkup(paper) : ''), [paper]);

  /* ---------- view fitting ---------- */
  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const z = Math.max(0.5, Math.min(40, Math.min((w - 90) / LW, (h - 90) / LH)));
    useStore.getState().setZoom(z);
    setPan({ x: (w - LW * z) / 2 + 9, y: (h - LH * z) / 2 + 9 });
  }, [LW, LH]);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const h = () => fit();
    window.addEventListener('labelloom:fit', h);
    return () => window.removeEventListener('labelloom:fit', h);
  }, [fit]);

  // zoom buttons keep the label centre fixed
  const lastZoom = useRef(zoom);
  useEffect(() => {
    if (lastZoom.current === zoom) return;
    if (!dragRef.current) {
      const cx = size.w / 2, cy = size.h / 2;
      const mx = (cx - pan.x) / lastZoom.current, my = (cy - pan.y) / lastZoom.current;
      setPan({ x: cx - mx * zoom, y: cy - my * zoom });
    }
    lastZoom.current = zoom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isTyping()) { setSpace(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // a drag that leaves the canvas would otherwise start a text selection across the
  // surrounding panels (user-select on the svg alone does not stop it)
  const dragging = drag !== null;
  useLayoutEffect(() => {
    if (!dragging) return;
    const block = (e: Event) => e.preventDefault();
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('canvas-dragging');
    document.addEventListener('selectstart', block);
    document.addEventListener('dragstart', block);
    return () => {
      document.body.classList.remove('canvas-dragging');
      document.removeEventListener('selectstart', block);
      document.removeEventListener('dragstart', block);
    };
  }, [dragging]);

  const toMm = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom };
  };

  // a touchpad pinch arrives as a ctrl+wheel; over the canvas it is our zoom, not the
  // page's. React's onWheel is passive, so the page zoom is blocked natively here and
  // stays available everywhere else.
  useEffect(() => {
    const el = wrap.current!;
    const wheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    const gesture = (e: Event) => e.preventDefault(); // Safari pinches with gesture events
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gesture);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', gesture); };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const r = wrap.current!.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z = Math.min(60, Math.max(0.5, zoom * Math.exp(-e.deltaY * 0.0055)));
      const wx = (mx - pan.x) / zoom, wy = (my - pan.y) / zoom;
      lastZoom.current = z;
      useStore.getState().setZoom(z);
      setPan({ x: mx - wx * z, y: my - wy * z });
    } else {
      setPan((p) => ({ x: p.x - (e.shiftKey ? e.deltaY : e.deltaX), y: p.y - (e.shiftKey ? 0 : e.deltaY) }));
    }
  };

  /* ---------- pointer handling ---------- */
  const startPan = (e: React.PointerEvent) => setDrag({ kind: 'pan', cx: e.clientX, cy: e.clientY, px: pan.x, py: pan.y });

  const onBackgroundDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || space) { startPan(e); return; }
    if (e.button !== 0) return;
    const m = toMm(e);
    if (tool !== 'select') { setDrag({ kind: 'create', sx: m.x, sy: m.y, x: m.x, y: m.y }); return; }
    if (!e.shiftKey) useStore.getState().select([]);
    setDrag({ kind: 'marquee', sx: m.x, sy: m.y, x: m.x, y: m.y, additive: e.shiftKey });
  };

  const onObjectDown = (e: React.PointerEvent, o: LabelObject) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || space) { startPan(e); return; }
    if (e.button !== 0) return;
    if (tool !== 'select') { onBackgroundDown(e); return; }
    const s = useStore.getState();
    const direct = e.ctrlKey || e.metaKey || e.altKey;
    const ids = direct ? [o.id] : expandGroups(objects, [o.id]);
    let next = s.selection;
    if (e.shiftKey) {
      next = ids.every((id) => s.selection.includes(id)) ? s.selection.filter((id) => !ids.includes(id)) : [...new Set([...s.selection, ...ids])];
    } else if (!ids.every((id) => s.selection.includes(id))) next = ids;
    s.select(next);
    const m = toMm(e);
    const orig = new Map<string, { x: number; y: number }>();
    objects.filter((x) => next.includes(x.id) && !x.locked).forEach((x) => orig.set(x.id, { x: x.x, y: x.y }));
    if (orig.size) setDrag({ kind: 'move', sx: m.x, sy: m.y, orig, started: false });
  };

  const onHandleDown = (e: React.PointerEvent, o: LabelObject, h: Handle | 'rot') => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const m = toMm(e);
    if (h === 'rot') setDrag({ kind: 'rotate', orig: o, started: false });
    else setDrag({ kind: 'resize', handle: h, sx: m.x, sy: m.y, orig: o, started: false });
  };

  const snapTargets = useMemo(() => {
    const ids = new Set(selection);
    const xs = [0, LW / 2, LW, paper.safeMargin, LW - paper.safeMargin];
    const ys = [0, LH / 2, LH, paper.safeMargin, LH - paper.safeMargin];
    if (bl > 0) { xs.push(-bl, LW + bl); ys.push(-bl, LH + bl); }
    if (paper.preprint) {
      const a = preprintArea(paper);
      xs.push(a.x, a.x + a.w); ys.push(a.y, a.y + a.h);
    }
    for (const o of objects) {
      if (ids.has(o.id) || o.hidden || o.rotation) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    return { xs, ys };
  }, [objects, selection, LW, LH, paper, bl]);

  const snap = (vals: number[], targets: number[], th: number) => {
    let best: { d: number; t: number } | null = null;
    for (const v of vals) for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
    return best;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') { setPan({ x: d.px + e.clientX - d.cx, y: d.py + e.clientY - d.cy }); return; }
    const m = toMm(e);
    const s = useStore.getState();
    if (d.kind === 'marquee' || d.kind === 'create') { setDrag({ ...d, x: m.x, y: m.y }); return; }
    if (d.kind === 'move') {
      let dx = m.x - d.sx, dy = m.y - d.sy;
      if (!d.started) {
        if (Math.hypot(dx, dy) * zoom < 3) return;
        s.checkpoint();
        setDrag({ ...d, started: true });
      }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const moving = objects.filter((o) => d.orig.has(o.id));
      const gx: number[] = [], gy: number[] = [];
      if (!e.altKey && moving.length) {
        const x0 = Math.min(...moving.map((o) => d.orig.get(o.id)!.x)) + dx;
        const y0 = Math.min(...moving.map((o) => d.orig.get(o.id)!.y)) + dy;
        const x1 = Math.max(...moving.map((o) => d.orig.get(o.id)!.x + o.w)) + dx;
        const y1 = Math.max(...moving.map((o) => d.orig.get(o.id)!.y + o.h)) + dy;
        const th = 6 / zoom;
        const sx = snap([x0, (x0 + x1) / 2, x1], snapTargets.xs, th);
        const sy = snap([y0, (y0 + y1) / 2, y1], snapTargets.ys, th);
        if (sx) { dx += sx.d; gx.push(sx.t); }
        if (sy) { dy += sy.d; gy.push(sy.t); }
      }
      setGuides({ x: gx, y: gy });
      act.update([...d.orig.keys()], (o) => ({ x: round(d.orig.get(o.id)!.x + dx), y: round(d.orig.get(o.id)!.y + dy) }), true);
      return;
    }
    if (d.kind === 'resize') {
      if (!d.started) { s.checkpoint(); setDrag({ ...d, started: true }); }
      const o = d.orig;
      const l = rot(m.x - d.sx, m.y - d.sy, -o.rotation);
      let w = o.w, h = o.h, sx = 0, sy = 0;
      const hd = d.handle;
      if (hd.includes('e')) w = o.w + l.x;
      if (hd.includes('w')) { w = o.w - l.x; sx = l.x; }
      if (hd.includes('s')) h = o.h + l.y;
      if (hd.includes('n')) { h = o.h - l.y; sy = l.y; }
      const keep = e.shiftKey || o.type === 'qr';
      if (keep && hd.length === 2) {
        const k = Math.max(w / o.w, h / o.h);
        const nw = o.w * k, nh = o.h * k;
        if (hd.includes('w')) sx = o.w - nw;
        if (hd.includes('n')) sy = o.h - nh;
        w = nw; h = nh;
      }
      const min = 0.5;
      if (w < min) { if (hd.includes('w')) sx -= min - w; w = min; }
      if (h < min) { if (hd.includes('n')) sy -= min - h; h = min; }
      const dc = rot(sx + w / 2 - o.w / 2, sy + h / 2 - o.h / 2, o.rotation);
      const cx = o.x + o.w / 2 + dc.x, cy = o.y + o.h / 2 + dc.y;
      act.update([o.id], { x: round(cx - w / 2), y: round(cy - h / 2), w: round(w), h: round(h) }, true);
      return;
    }
    if (d.kind === 'rotate') {
      if (!d.started) { s.checkpoint(); setDrag({ ...d, started: true }); }
      const o = d.orig;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      let a = (Math.atan2(m.y - cy, m.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((Math.round(a * 10) / 10) % 360 + 360) % 360;
      act.update([o.id], { rotation: a }, true);
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    setDrag(null);
    setGuides({ x: [], y: [] });
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === 'marquee') {
      const x0 = Math.min(d.sx, d.x), x1 = Math.max(d.sx, d.x), y0 = Math.min(d.sy, d.y), y1 = Math.max(d.sy, d.y);
      if ((x1 - x0) * zoom < 3 && (y1 - y0) * zoom < 3) return;
      const hit = objects.filter((o) => !o.hidden && !o.locked && o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0).map((o) => o.id);
      const ids = expandGroups(objects, hit);
      s.select(d.additive ? [...new Set([...s.selection, ...ids])] : ids);
    }
    if (d.kind === 'create' && tool !== 'select') {
      const x = Math.min(d.sx, d.x), y = Math.min(d.sy, d.y), w = Math.abs(d.x - d.sx), h = Math.abs(d.y - d.sy);
      const small = w * zoom < 6 && h * zoom < 6;
      const o = act.add(tool, round(x), round(y), small ? undefined : round(Math.max(1, w)), small ? undefined : round(Math.max(tool === 'line' ? 0.5 : 1, h)));
      if (tool === 'image' || tool === 'svg') pickImageInto(o.id, tool);
      if (tool === 'text') setEditing(o.id);
    }
  };

  const onDouble = (o: LabelObject) => {
    if (o.type === 'image' || o.type === 'svg') pickImageInto(o.id, o.type);
    else if ('content' in o && !o.locked) { useStore.getState().select([o.id]); setEditing(o.id); }
  };

  /* ---------- drawing helpers ---------- */
  const px = 1 / zoom;
  const selected = objects.filter((o) => selection.includes(o.id));
  const single = selected.length === 1 && !selected[0].locked ? selected[0] : null;
  const cursor = drag?.kind === 'pan' || space ? 'grabbing' : tool !== 'select' ? 'crosshair' : 'default';

  return (
    <div className="canvas-wrap" ref={wrap} onWheel={onWheel} style={{ cursor }}>
      <svg className="canvas-svg" width={size.w} height={size.h} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <defs>
          <filter id="paper-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy={0.6 * px * 2} stdDeviation={3 * px} floodOpacity="0.18" /></filter>
          <pattern id="checker" width={4 * px} height={4 * px} patternUnits="userSpaceOnUse"><rect width={2 * px} height={2 * px} fill="#e5e7eb" /><rect x={2 * px} y={2 * px} width={2 * px} height={2 * px} fill="#e5e7eb" /></pattern>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {bl > 0 && <rect x={-bl} y={-bl} width={LW + 2 * bl} height={LH + 2 * bl} fill="#fff" opacity={0.55} />}
          <rect width={LW} height={LH} rx={bl > 0 ? 0 : paper.cornerRadius} fill="#fff" filter="url(#paper-shadow)" />
          <g className="label-content" dangerouslySetInnerHTML={{ __html: markup }} />
          {/* artwork already on the stock: shown as if printed under the content, never exported */}
          {preprint && <g className="preprint" opacity={0.85} pointerEvents="none" dangerouslySetInnerHTML={{ __html: preprint }} />}
          {/* anything beyond the trim line + bleed is not printed: fade it */}
          <path d={`M${-bl - 1e4} ${-bl - 1e4}h${LW + 2 * bl + 2e4}v${LH + 2 * bl + 2e4}h${-(LW + 2 * bl + 2e4)}Z M${-bl} ${-bl}v${LH + 2 * bl}h${LW + 2 * bl}v${-(LH + 2 * bl)}Z`}
            style={{ fill: 'var(--canvas)' }} fillRule="evenodd" opacity={0.72} pointerEvents="none" />
          {bl > 0 && <rect x={-bl} y={-bl} width={LW + 2 * bl} height={LH + 2 * bl} fill="none" stroke="#f97316" strokeWidth={px} strokeDasharray={`${4 * px} ${3 * px}`} pointerEvents="none" />}
          <rect width={LW} height={LH} rx={paper.cornerRadius} fill="none" stroke={bl > 0 ? '#475569' : '#94a3b8'} strokeWidth={px} pointerEvents="none" />
          {paper.safeMargin > 0 && (
            <rect x={paper.safeMargin} y={paper.safeMargin} width={Math.max(0, LW - 2 * paper.safeMargin)} height={Math.max(0, LH - 2 * paper.safeMargin)}
              fill="none" stroke="#38bdf8" strokeWidth={px} strokeDasharray={`${3 * px} ${3 * px}`} opacity={0.6} pointerEvents="none" />
          )}
          {/* hit targets */}
          {objects.map((o) => !o.hidden && (
            <rect key={o.id} transform={objTransform(o)} y={o.h * zoom < 8 ? (o.h - 8 * px) / 2 : 0}
              width={Math.max(o.w, 8 * px)} height={Math.max(o.h, 8 * px)} fill="transparent"
              className={`hit ${o.locked ? 'locked' : ''}`}
              onPointerDown={(e) => onObjectDown(e, o)} onDoubleClick={() => onDouble(o)} />
          ))}
          {/* non-printing guides */}
          {objects.map((o) => o.noPrint && !o.hidden && (
            <rect key={'np' + o.id} transform={objTransform(o)} width={o.w} height={o.h} fill="none" stroke="#a855f7"
              strokeWidth={px} strokeDasharray={`${2 * px} ${2 * px}`} pointerEvents="none" />
          ))}
          {/* selection outlines */}
          {selected.map((o) => (
            <rect key={'s' + o.id} transform={objTransform(o)} width={o.w} height={o.h} fill="none"
              stroke={o.locked ? '#f59e0b' : '#2563eb'} strokeWidth={1.5 * px} pointerEvents="none" />
          ))}
          {single && (
            <g transform={objTransform(single)}>
              <line x1={single.w / 2} y1={0} x2={single.w / 2} y2={-18 * px} stroke="#2563eb" strokeWidth={px} />
              <circle cx={single.w / 2} cy={-18 * px} r={4.5 * px} fill="#fff" stroke="#2563eb" strokeWidth={1.5 * px}
                style={{ cursor: 'grab' }} onPointerDown={(e) => onHandleDown(e, single, 'rot')} />
              {HANDLES.map(({ h, fx, fy, cursor: c }) => (
                <rect key={h} x={single.w * fx - 4 * px} y={single.h * fy - 4 * px} width={8 * px} height={8 * px}
                  fill="#fff" stroke="#2563eb" strokeWidth={1.5 * px} style={{ cursor: c }}
                  onPointerDown={(e) => onHandleDown(e, single, h)} />
              ))}
            </g>
          )}
          {guides.x.map((x, i) => <line key={'gx' + i} x1={x} x2={x} y1={-1000} y2={1000} stroke="#ec4899" strokeWidth={px} pointerEvents="none" />)}
          {guides.y.map((y, i) => <line key={'gy' + i} y1={y} y2={y} x1={-1000} x2={1000} stroke="#ec4899" strokeWidth={px} pointerEvents="none" />)}
          {(drag?.kind === 'marquee' || drag?.kind === 'create') && (
            <rect x={Math.min(drag.sx, drag.x)} y={Math.min(drag.sy, drag.y)} width={Math.abs(drag.x - drag.sx)} height={Math.abs(drag.y - drag.sy)}
              fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={px} strokeDasharray={drag.kind === 'marquee' ? `${3 * px} ${2 * px}` : undefined} pointerEvents="none" />
          )}
        </g>
      </svg>
      <Rulers pan={pan} zoom={zoom} size={size} selected={single} />
      {editObj && !drag && (
        <InlineEditor key={editObj.id} o={editObj} onClose={() => setEditing(null)}
          left={Math.min(Math.max(8, pan.x + editObj.x * zoom), Math.max(8, size.w - 288))}
          top={Math.min(pan.y + (editObj.y + editObj.h) * zoom + 10, Math.max(8, size.h - 200))} />
      )}
      {single && drag && drag.kind !== 'pan' && drag.kind !== 'marquee' && (
        <div className="measure">{single.x.toFixed(1)}, {single.y.toFixed(1)} · {single.w.toFixed(1)}×{single.h.toFixed(1)} mm{single.rotation ? ` · ${single.rotation}°` : ''}</div>
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

type ContentObj = TextObj | BarcodeObj | QrObj;

/**
 * Edits an object's content right on the canvas. Columns bound with {{열 이름}} are edited
 * as values of the current data row, so the table below changes with them; the design
 * template itself (shared by every label) is edited in the last field.
 */
function InlineEditor({ o, left, top, onClose }: { o: ContentObj; left: number; top: number; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const currentRow = useStore((s) => s.currentRow);
  const row = project.data.rows[currentRow];
  const cols = [...new Set(templateColumns(o.content))];
  const started = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    el?.focus();
    el?.select();
  }, []);

  // one undo step for the whole edit
  const begin = () => { if (!started.current) { useStore.getState().checkpoint(); started.current = true; } };
  const setValue = (col: string, v: string) => {
    begin();
    useStore.getState().live((p) => {
      const columns = p.data.columns.includes(col) ? p.data.columns : [...p.data.columns, col];
      const rows = p.data.rows[currentRow]
        ? p.data.rows.map((r, i) => (i === currentRow ? { ...r, values: { ...r.values, [col]: v } } : r))
        : [...p.data.rows, newRow({ [col]: v })];
      return { ...p, data: { columns, rows } };
    });
  };
  const setContent = (v: string) => { begin(); act.update([o.id], { content: v } as Partial<LabelObject>, true); };

  const cancel = () => { if (started.current) useStore.getState().undo(); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onClose(); }
  };
  const onBlur = (e: React.FocusEvent) => { if (!box.current?.contains(e.relatedTarget as Node)) onClose(); };
  const multi = o.type === 'text' && o.multiline;

  return (
    <div className="inline-editor" ref={box} style={{ left, top }} onKeyDown={onKey} onBlur={onBlur} onPointerDown={(e) => e.stopPropagation()}>
      {cols.length > 0 && (
        <>
          <div className="ie-head">
            <span>데이터 · {row ? `${currentRow + 1}행` : '새 행'}</span>
            <span className="ie-hint">아래 표에 바로 반영</span>
          </div>
          {cols.map((c) => (
            <label key={c} className="ie-field">
              <span>{c}</span>
              <input value={row?.values[c] ?? ''} onChange={(e) => setValue(c, e.target.value)} spellCheck={false} />
            </label>
          ))}
        </>
      )}
      <label className="ie-field">
        <span>{cols.length ? '디자인 문구 (모든 라벨)' : '내용'}</span>
        <textarea rows={multi || o.content.includes('\n') ? 3 : 1} value={o.content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
      </label>
      <div className="ie-foot">Enter 완료 · Shift+Enter 줄바꿈 · Esc 취소</div>
    </div>
  );
}

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function Rulers({ pan, zoom, size, selected }: { pan: { x: number; y: number }; zoom: number; size: { w: number; h: number }; selected: LabelObject | null }) {
  const R = 18;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const step = steps.find((s) => s * zoom >= 7) ?? 100;
  const major = step * (step === 2 || step === 20 ? 5 : step === 0.5 || step === 5 || step === 50 ? 2 : 10);
  const ticks = (len: number, offset: number) => {
    const out: { p: number; v: number; major: boolean }[] = [];
    const a = Math.floor(-offset / zoom / step) * step, b = (len - offset) / zoom;
    for (let v = a; v <= b; v += step) {
      const vv = Math.round(v * 100) / 100;
      out.push({ p: offset + vv * zoom, v: vv, major: Math.abs(vv / major - Math.round(vv / major)) < 1e-6 });
    }
    return out;
  };
  // the rulers start after the corner box, R px into the canvas, so shift by R to line up with it
  const ox = pan.x - R, oy = pan.y - R;
  const tx = ticks(size.w - R, ox), ty = ticks(size.h - R, oy);
  return (
    <>
      <svg className="ruler ruler-x" width={Math.max(0, size.w - R)} height={R}>
        {selected && <rect x={ox + selected.x * zoom} width={selected.w * zoom} height={R} fill="rgba(37,99,235,0.15)" />}
        {tx.map((t) => <g key={t.v}><line x1={t.p} x2={t.p} y1={t.major ? 4 : 12} y2={R} />{t.major && <text x={t.p + 2} y={10}>{t.v}</text>}</g>)}
      </svg>
      <svg className="ruler ruler-y" width={R} height={Math.max(0, size.h - R)}>
        {selected && <rect y={oy + selected.y * zoom} height={selected.h * zoom} width={R} fill="rgba(37,99,235,0.15)" />}
        {ty.map((t) => <g key={t.v}><line y1={t.p} y2={t.p} x1={t.major ? 4 : 12} x2={R} />{t.major && <text x={10} y={t.p + 2} transform={`rotate(-90 10 ${t.p + 2})`}>{t.v}</text>}</g>)}
      </svg>
      <div className="ruler-corner">mm</div>
    </>
  );
}
