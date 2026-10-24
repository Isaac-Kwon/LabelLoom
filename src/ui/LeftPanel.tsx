import { useMemo, useState } from 'react';
import { readAsDataURL, pickFile } from '../io/project';
import { download } from '../io/export';
import { TYPE_LABEL, uid } from '../model/defaults';
import { centerGrid, loadUserPresets, PAPER_PRESETS, saveUserPresets } from '../model/presets';
import type { LabelObject, Paper } from '../model/types';
import { preprintArea } from '../render/preprint';
import { RULE_OPS } from '../render/resolve';
import { act, currentObjects, expandGroups, useStore } from '../store';
import { Check, Color, Num, Row, Section, Select, Seg } from './controls';
import { moveToIndex } from './ops';

export function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'paper' | 'designs'>('layers');
  return (
    <aside className="left-panel">
      <div className="tabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>레이어</button>
        <button className={tab === 'paper' ? 'on' : ''} onClick={() => setTab('paper')}>용지</button>
        <button className={tab === 'designs' ? 'on' : ''} onClick={() => setTab('designs')}>디자인</button>
      </div>
      <div className="panel-scroll">
        {tab === 'layers' && <><Layers /><Components /></>}
        {tab === 'paper' && <PaperPanel />}
        {tab === 'designs' && <DesignsPanel />}
      </div>
    </aside>
  );
}

const ICON: Record<LabelObject['type'], string> = { text: 'T', rect: '▭', ellipse: '◯', triangle: '△', line: '╱', barcode: '▥', qr: '▦', image: '🖼', svg: '✒', table: '▤' };

function Layers() {
  const project = useStore((s) => s.project);
  const designId = useStore((s) => s.designId);
  const side = useStore((s) => s.side);
  const selection = useStore((s) => s.selection);
  const objects = currentObjects({ project, designId, side });
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const list = [...objects].reverse();

  const click = (e: React.MouseEvent, o: LabelObject) => {
    const s = useStore.getState();
    const ids = e.altKey ? [o.id] : expandGroups(objects, [o.id]);
    if (e.shiftKey || e.ctrlKey || e.metaKey) s.select(ids.every((id) => s.selection.includes(id)) ? s.selection.filter((i) => !ids.includes(i)) : [...new Set([...s.selection, ...ids])]);
    else s.select(ids);
  };

  let lastGroup: string | undefined;
  return (
    <Section title={`레이어 (${objects.length})`}>
      {!objects.length && <p className="muted small">개체가 없습니다. 위 도구 막대에서 추가하세요.</p>}
      <ul className="layers">
        {list.map((o) => {
          const header = o.groupId && o.groupId !== lastGroup;
          lastGroup = o.groupId;
          return (
            <li key={o.id}>
              {header && <div className="layer-group">▾ 그룹</div>}
              <div
                className={`layer ${selection.includes(o.id) ? 'sel' : ''} ${o.groupId ? 'grouped' : ''} ${dragId === o.id ? 'dragging' : ''}`}
                draggable onDragStart={() => setDragId(o.id)} onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId && dragId !== o.id) moveToIndex(dragId, objects.findIndex((x) => x.id === o.id)); setDragId(null); }}
                onClick={(e) => click(e, o)} onDoubleClick={() => setEditing(o.id)}
              >
                <span className="layer-icon" title={TYPE_LABEL[o.type]}>{ICON[o.type]}</span>
                {editing === o.id ? (
                  <input autoFocus defaultValue={o.name} onBlur={(e) => { act.update([o.id], { name: e.target.value }); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <span className={`layer-name ${o.hidden ? 'muted' : ''}`}>{o.name || TYPE_LABEL[o.type]}{'content' in o && /\{\{/.test(o.content) ? <span className="bound" title={o.content}> ⛓</span> : null}{o.rules.length ? <span className="bound" title="조건부 스타일"> ◆</span> : null}</span>
                )}
                <button className={`icon tiny ${o.locked ? 'active' : ''}`} title={o.locked ? '잠금 해제' : '잠금'} onClick={(e) => { e.stopPropagation(); act.update([o.id], { locked: !o.locked }); }}>{o.locked ? '🔒' : '🔓'}</button>
                <button className={`icon tiny ${o.hidden ? 'active' : ''}`} title={o.hidden ? '보이기' : '숨기기'} onClick={(e) => { e.stopPropagation(); act.update([o.id], { hidden: !o.hidden }); }}>{o.hidden ? '◌' : '👁'}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ---------- components library ---------- */

interface Component { id: string; name: string; objects: LabelObject[] }
const COMP_KEY = 'labelloom.components';
const loadComps = (): Component[] => { try { return JSON.parse(localStorage.getItem(COMP_KEY) || '[]'); } catch { return []; } };
const saveComps = (c: Component[]) => { try { localStorage.setItem(COMP_KEY, JSON.stringify(c)); } catch { useStore.getState().notify('저장 공간이 부족합니다.'); } };

function Components() {
  const [comps, setComps] = useState(loadComps);
  const selection = useStore((s) => s.selection);
  const update = (c: Component[]) => { setComps(c); saveComps(c); };
  const save = () => {
    const s = useStore.getState();
    const objs = currentObjects(s).filter((o) => s.selection.includes(o.id));
    if (!objs.length) return;
    const name = prompt('컴포넌트 이름', objs.length === 1 ? objs[0].name : `컴포넌트 ${comps.length + 1}`);
    if (!name) return;
    const x0 = Math.min(...objs.map((o) => o.x)), y0 = Math.min(...objs.map((o) => o.y));
    update([...comps, { id: Date.now().toString(36), name, objects: objs.map((o) => ({ ...o, x: o.x - x0, y: o.y - y0 })) }]);
    s.notify(`"${name}" 컴포넌트를 저장했습니다.`);
  };
  const importFile = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const add = JSON.parse(await f.text()) as Component[];
      if (!Array.isArray(add)) throw new Error();
      update([...comps, ...add]);
    } catch { useStore.getState().notify('컴포넌트 파일이 올바르지 않습니다.'); }
  };
  return (
    <Section title={`내 컴포넌트 (${comps.length})`} defaultOpen={comps.length > 0}
      actions={<button className="icon small" title="선택 개체를 컴포넌트로 저장" disabled={!selection.length} onClick={save}>＋</button>}>
      {!comps.length && <p className="muted small">자주 쓰는 개체 묶음을 선택하고 ＋를 눌러 저장하면 다른 라벨에도 넣을 수 있습니다.</p>}
      <ul className="comp-list">
        {comps.map((c) => (
          <li key={c.id}>
            <button className="comp" onClick={() => act.insert(c.objects.map((o) => ({ ...o, x: o.x + 2, y: o.y + 2 })))} title="현재 디자인에 넣기">
              <span>{c.name}</span><span className="muted small">{c.objects.length}개</span>
            </button>
            <button className="icon tiny" title="삭제" onClick={() => confirm(`"${c.name}" 삭제?`) && update(comps.filter((x) => x.id !== c.id))}>✕</button>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button onClick={importFile}>가져오기</button>
        <button disabled={!comps.length} onClick={() => download(new Blob([JSON.stringify(comps, null, 1)], { type: 'application/json' }), 'labelloom-components.json')}>내보내기</button>
      </div>
    </Section>
  );
}

/* ---------- paper ---------- */

function PaperPanel() {
  const paper = useStore((s) => s.project.paper);
  const [userPresets, setUserPresets] = useState(loadUserPresets);
  const [unit, setUnit] = useState<'mm' | 'in'>('mm');
  const k = unit === 'mm' ? 1 : 25.4;
  const up = (p: Partial<Paper>) => useStore.getState().commit((proj) => ({ ...proj, paper: { ...proj.paper, ...p } }));
  const L = (mm: number) => mm / k;
  const M = (v: number) => Math.round(v * k * 100) / 100;
  const allPresets = useMemo(() => [...PAPER_PRESETS, { group: '내 프리셋', items: userPresets }], [userPresets]);
  const maxCols = Math.max(1, Math.floor((paper.width - paper.marginLeft + paper.gapX) / (paper.labelWidth + paper.gapX) + 1e-6));
  const maxRows = Math.max(1, Math.floor((paper.height - paper.marginTop + paper.gapY) / (paper.labelHeight + paper.gapY) + 1e-6));
  const overflow = paper.cols > maxCols || paper.rows > maxRows;

  const applyPreset = (name: string) => {
    const p = allPresets.flatMap((g) => g.items).find((x) => x.name === name);
    if (p) up({ ...p, background: paper.background, labelColor: paper.labelColor, preprint: p.preprint });
    setTimeout(() => window.dispatchEvent(new Event('labelloom:fit')), 0);
  };
  const savePreset = () => {
    const name = prompt('프리셋 이름', paper.name || `${paper.labelWidth}×${paper.labelHeight}`);
    if (!name) return;
    const { background: _bg, ...rest } = paper;
    void _bg;
    const list = [...userPresets.filter((p) => p.name !== name), { ...rest, name }];
    setUserPresets(list); saveUserPresets(list); up({ name });
  };
  const removePreset = () => {
    if (!userPresets.some((p) => p.name === paper.name) || !confirm(`"${paper.name}" 프리셋 삭제?`)) return;
    const list = userPresets.filter((p) => p.name !== paper.name);
    setUserPresets(list); saveUserPresets(list);
  };
  const importPresets = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const add = JSON.parse(await f.text()) as Paper[];
      const list = [...userPresets.filter((p) => !add.some((a) => a.name === p.name)), ...add];
      setUserPresets(list); saveUserPresets(list);
    } catch { useStore.getState().notify('프리셋 파일이 올바르지 않습니다.'); }
  };

  return (
    <>
      <Section title="프리셋">
        <select value={allPresets.some((g) => g.items.some((x) => x.name === paper.name)) ? paper.name : ''} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">— 사용자 정의 —</option>
          {allPresets.map((g) => g.items.length > 0 && <optgroup key={g.group} label={g.group}>{g.items.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>)}
        </select>
        <div className="btn-row">
          <button onClick={savePreset}>내 프리셋으로 저장</button>
          <button onClick={removePreset} disabled={!userPresets.some((p) => p.name === paper.name)}>삭제</button>
        </div>
        <div className="btn-row">
          <button onClick={importPresets}>프리셋 가져오기</button>
          <button disabled={!userPresets.length} onClick={() => download(new Blob([JSON.stringify(userPresets, null, 1)], { type: 'application/json' }), 'labelloom-presets.json')}>내보내기</button>
        </div>
      </Section>
      <Section title="크기" actions={<Seg value={unit} onChange={setUnit} options={[{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]} />}>
        <Row label="이름"><input type="text" value={paper.name} onChange={(e) => up({ name: e.target.value })} /></Row>
        <p className="sub">용지</p>
        <div className="grid2">
          <Num label="폭" value={L(paper.width)} step={unit === 'mm' ? 0.5 : 0.01} min={1} onChange={(v) => up({ width: M(v) })} unit={unit} />
          <Num label="높이" value={L(paper.height)} step={unit === 'mm' ? 0.5 : 0.01} min={1} onChange={(v) => up({ height: M(v) })} unit={unit} />
        </div>
        <div className="btn-row">
          <button onClick={() => up({ width: paper.height, height: paper.width })} title="가로/세로 바꾸기">⟲ 방향 바꾸기</button>
          <button onClick={() => up({ width: paper.labelWidth, height: paper.labelHeight, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0 })} title="롤 라벨 프린터용">용지 = 라벨</button>
        </div>
        <p className="sub">라벨 (디자인 영역)</p>
        <div className="grid2">
          <Num label="폭" value={L(paper.labelWidth)} step={unit === 'mm' ? 0.5 : 0.01} min={1} onChange={(v) => { up({ labelWidth: M(v) }); }} unit={unit} />
          <Num label="높이" value={L(paper.labelHeight)} step={unit === 'mm' ? 0.5 : 0.01} min={1} onChange={(v) => { up({ labelHeight: M(v) }); }} unit={unit} />
          <Num label="모서리" value={L(paper.cornerRadius)} step={unit === 'mm' ? 0.5 : 0.01} min={0} onChange={(v) => up({ cornerRadius: M(v) })} unit={unit} />
        </div>
        <Row><button onClick={() => window.dispatchEvent(new Event('labelloom:fit'))}>화면에 맞추기</button></Row>
      </Section>
      <Section title="셀 분할 (한 장에 여러 라벨)">
        <div className="grid2">
          <Num label="가로 칸" value={paper.cols} step={1} min={1} max={50} onChange={(v) => up({ cols: Math.round(v) })} />
          <Num label="세로 칸" value={paper.rows} step={1} min={1} max={80} onChange={(v) => up({ rows: Math.round(v) })} />
          <Num label="왼쪽 여백" value={L(paper.marginLeft)} step={unit === 'mm' ? 0.1 : 0.01} onChange={(v) => up({ marginLeft: M(v) })} unit={unit} />
          <Num label="위쪽 여백" value={L(paper.marginTop)} step={unit === 'mm' ? 0.1 : 0.01} onChange={(v) => up({ marginTop: M(v) })} unit={unit} />
          <Num label="가로 간격" value={L(paper.gapX)} step={unit === 'mm' ? 0.1 : 0.01} min={0} onChange={(v) => up({ gapX: M(v) })} unit={unit} />
          <Num label="세로 간격" value={L(paper.gapY)} step={unit === 'mm' ? 0.1 : 0.01} min={0} onChange={(v) => up({ gapY: M(v) })} unit={unit} />
          <Num label="가로 피치" title="라벨 왼쪽 끝 ~ 다음 라벨 왼쪽 끝 (라벨지 실측값)" value={L(paper.labelWidth + paper.gapX)} step={unit === 'mm' ? 0.1 : 0.01} onChange={(v) => up({ gapX: Math.max(0, M(v) - paper.labelWidth) })} unit={unit} />
          <Num label="세로 피치" title="라벨 위쪽 끝 ~ 다음 라벨 위쪽 끝 (라벨지 실측값)" value={L(paper.labelHeight + paper.gapY)} step={unit === 'mm' ? 0.1 : 0.01} onChange={(v) => up({ gapY: Math.max(0, M(v) - paper.labelHeight) })} unit={unit} />
        </div>
        <div className="btn-row">
          <button onClick={() => up(centerGrid(paper.width, paper.height, paper.labelWidth, paper.labelHeight, paper.cols, paper.rows, paper.gapX, paper.gapY))}>가운데 배치</button>
          <button onClick={() => up({ cols: maxCols, rows: maxRows })} title="현재 여백·간격으로 들어가는 최대 칸 수">최대 칸 수</button>
        </div>
        {overflow && <div className="warn">⚠ 라벨이 용지 밖으로 나갑니다 (최대 {maxCols}×{maxRows}칸).</div>}
        <SheetPreview paper={paper} />
      </Section>
      <Section title="안내선·출력">
        <div className="grid2">
          <Num label="안전 여백" title="인쇄되지 않을 수 있는 가장자리 안내선" value={paper.safeMargin} step={0.5} min={0} unit="mm" onChange={(v) => up({ safeMargin: v })} />
          <Num label="재단 여백" title="블리드(bleed) — 재단선 밖으로 더 인쇄되는 영역. 가장자리에 닿는 도형·배경을 이만큼 크게 그리면 재단이 조금 어긋나도 흰 틈이 생기지 않습니다." value={paper.bleed} step={0.5} min={0} max={5} unit="mm" onChange={(v) => up({ bleed: v })} />
          <Num label="해상도" value={paper.dpi} step={50} min={72} max={1200} unit="dpi" onChange={(v) => up({ dpi: v })} />
        </div>
        {paper.bleed > 0 && (
          <p className="muted small">
            주황 점선까지 그린 부분이 인쇄됩니다. 인쇄할 때 "재단선 표시"를 켜면 라벨 가장자리(재단선)에 긴 표시가, 재단 여백 가장자리(주황 점선)에 짧은 표시가 찍힙니다.
            {((paper.cols > 1 && paper.gapX < 2 * paper.bleed) || (paper.rows > 1 && paper.gapY < 2 * paper.bleed)) && ` 칸 간격을 ${2 * paper.bleed} mm 이상으로 두어야 라벨 사이에서도 재단 여백이 온전히 인쇄됩니다.`}
          </p>
        )}
        <Row label="라벨 색"><Color value={paper.labelColor} onChange={(c) => up({ labelColor: c })} /></Row>
        <Row><button onClick={() => useStore.getState().open('calibration')}>프린터 정렬 보정…</button></Row>
      </Section>
      <Section title="배경 이미지" defaultOpen={!!paper.background}>
        <div className="btn-row">
          <button onClick={async () => { const f = await pickFile('image/*'); if (f) up({ background: { src: await readAsDataURL(f), fit: 'cover', opacity: 1, print: true, ...(paper.background ? { fit: paper.background.fit, opacity: paper.background.opacity, print: paper.background.print } : {}) } }); }}>{paper.background ? '변경' : '이미지 선택'}</button>
          {paper.background && <button onClick={() => up({ background: undefined })}>제거</button>}
        </div>
        {paper.background && (
          <>
            <Row label="맞춤"><Select value={paper.background.fit} onChange={(v) => up({ background: { ...paper.background!, fit: v } })} options={[{ value: 'cover', label: '채움' }, { value: 'contain', label: '맞춤' }, { value: 'stretch', label: '늘이기' }]} /></Row>
            <Row label="불투명"><Num value={Math.round(paper.background.opacity * 100)} step={5} min={0} max={100} unit="%" onChange={(v) => up({ background: { ...paper.background!, opacity: v / 100 } })} /></Row>
            <Check label="배경도 인쇄" checked={paper.background.print} onChange={(v) => up({ background: { ...paper.background!, print: v } })} />
          </>
        )}
      </Section>
      <Section title="미리 인쇄된 테두리 (견출지)" defaultOpen={!!paper.preprint}>
        {paper.preprint ? (
          <>
            <Check label="화면에 표시 (인쇄 안 됨)" checked={paper.preprint.show} onChange={(v) => up({ preprint: { ...paper.preprint!, show: v } })} />
            <Row label="색"><Color value={paper.preprint.color} onChange={(c) => up({ preprint: { ...paper.preprint!, color: c } })} /></Row>
            <p className="muted small">입력 영역 {preprintArea(paper).w.toFixed(1)} × {preprintArea(paper).h.toFixed(1)} mm. 개체를 옮기면 입력 영역 가장자리에도 맞춰집니다.</p>
            <div className="btn-row">
              <button onClick={() => useStore.getState().open('preprint')}>마법사로 수정…</button>
              <button onClick={() => up({ preprint: undefined })}>제거</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">테두리·그림이 이미 인쇄된 라벨지에 내용만 인쇄할 때, 입력 영역 크기·테두리 두께·라벨 간격을 넣으면 용지가 설정되고 인쇄된 위치가 화면에 보입니다.</p>
            <button onClick={() => useStore.getState().open('preprint')}>견출지 마법사…</button>
          </>
        )}
      </Section>
    </>
  );
}

function SheetPreview({ paper }: { paper: Paper }) {
  const cells = [];
  for (let r = 0; r < Math.min(paper.rows, 80); r++) for (let c = 0; c < Math.min(paper.cols, 50); c++) {
    cells.push(<rect key={`${r}-${c}`} x={paper.marginLeft + c * (paper.labelWidth + paper.gapX)} y={paper.marginTop + r * (paper.labelHeight + paper.gapY)}
      width={paper.labelWidth} height={paper.labelHeight} rx={paper.cornerRadius} fill={r === 0 && c === 0 ? '#bfdbfe' : '#e5e7eb'} stroke="#64748b" strokeWidth={0.4} />);
  }
  return (
    <svg className="sheet-preview" viewBox={`-2 -2 ${paper.width + 4} ${paper.height + 4}`}>
      <rect width={paper.width} height={paper.height} fill="#fff" stroke="#334155" strokeWidth={0.6} />
      {cells}
    </svg>
  );
}

/* ---------- designs ---------- */

function DesignsPanel() {
  const project = useStore((s) => s.project);
  const designId = useStore((s) => s.designId);
  const side = useStore((s) => s.side);
  const s = useStore.getState;
  const commit = useStore((x) => x.commit);
  const rules = project.designRules;
  const setRules = (r: typeof rules) => commit((p) => ({ ...p, designRules: r }));
  const cur = project.designs.find((d) => d.id === designId) ?? project.designs[0];
  return (
    <>
      <Section title="디자인" actions={<button className="icon small" title="새 디자인" onClick={() => act.addDesign()}>＋</button>}>
        <ul className="design-list">
          {project.designs.map((d, i) => (
            <li key={d.id} className={d.id === designId ? 'sel' : ''} onClick={() => s().setDesign(d.id)}>
              <input value={d.name} onChange={(e) => commit((p) => ({ ...p, designs: p.designs.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)) }))} onClick={(e) => e.stopPropagation()} />
              {i === 0 && <span className="badge" title="규칙에 맞지 않는 행은 이 디자인을 씁니다">기본</span>}
              <button className="icon tiny" title="복제" onClick={(e) => { e.stopPropagation(); act.addDesign(d); }}>⧉</button>
              <button className="icon tiny" title="삭제" disabled={project.designs.length < 2} onClick={(e) => {
                e.stopPropagation();
                if (!confirm(`"${d.name}" 디자인을 삭제할까요?`)) return;
                commit((p) => ({ ...p, designs: p.designs.filter((x) => x.id !== d.id), designRules: p.designRules.filter((r) => r.designId !== d.id) }));
              }}>✕</button>
            </li>
          ))}
        </ul>
        <p className="muted small">맨 위 디자인이 기본입니다. 순서를 바꾸려면 ↑를 누르세요.</p>
        {project.designs.length > 1 && cur.id !== project.designs[0].id && (
          <button onClick={() => commit((p) => ({ ...p, designs: [cur, ...p.designs.filter((d) => d.id !== cur.id)] }))}>↑ 기본 디자인으로</button>
        )}
      </Section>
      <Section title="면 (양면 인쇄)">
        <Seg value={side} onChange={(v) => s().setDesign(designId, v)} options={[{ value: 'front', label: '앞면' }, { value: 'back', label: `뒷면${cur.back ? '' : ' (없음)'}` }]} />
        {side === 'back' && !cur.back?.length && (
          <div className="btn-row">
            <button onClick={() => commit((p) => ({ ...p, designs: p.designs.map((d) => (d.id === cur.id ? { ...d, back: structuredClone(d.objects).map((o) => ({ ...o, id: uid() })) } : d)) }))}>앞면 복사해서 시작</button>
          </div>
        )}
        {cur.back && cur.back.length > 0 && (
          <button onClick={() => { if (confirm('뒷면을 삭제할까요?')) { commit((p) => ({ ...p, designs: p.designs.map((d) => (d.id === cur.id ? { ...d, back: undefined } : d)) })); s().setDesign(cur.id, 'front'); } }}>뒷면 삭제</button>
        )}
        <p className="muted small">내보내기에서 "양면"을 켜면 각 장 뒤에 뒷면 장을 추가하거나(앞뒤 따로 인쇄), 앞면 옆·아래에 뒷면을 붙여 한 면에 인쇄한 뒤 접을 수 있습니다(펼쳐서 접기).</p>
      </Section>
      <Section title={`디자인 자동 선택 규칙 (${rules.length})`}
        actions={<button className="icon small" title="규칙 추가" disabled={project.designs.length < 2} onClick={() => setRules([...rules, { column: project.data.columns[0] ?? '', op: 'eq', value: '', designId: project.designs[1]?.id ?? project.designs[0].id }])}>＋</button>}>
        {project.designs.length < 2 && <p className="muted small">디자인이 2개 이상일 때 행 값에 따라 디자인을 고를 수 있습니다. 예: 참가구분 = 연사 → 연사 명찰.</p>}
        {rules.map((r, i) => (
          <div className="rule" key={i}>
            <div className="rule-if">
              <select value={r.column} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}>
                {project.data.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                {!project.data.columns.includes(r.column) && <option value={r.column}>{r.column || '(열 선택)'}</option>}
              </select>
              <Select value={r.op} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, op: v } : x)))} options={RULE_OPS.map((x) => ({ value: x.op, label: x.label }))} />
              {RULE_OPS.find((x) => x.op === r.op)?.needsValue && <input value={r.value} placeholder="값" onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
            </div>
            <div className="rule-then">
              <span className="muted">→</span>
              <Select value={r.designId} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, designId: v } : x)))} options={project.designs.map((d) => ({ value: d.id, label: d.name }))} />
              <button className="icon tiny" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
      </Section>
      <Section title="일련번호">
        <Row label="시작 번호"><Num value={project.seqStart} step={1} onChange={(v) => commit((p) => ({ ...p, seqStart: Math.round(v) }))} /></Row>
        <p className="muted small"><code>{'{{#seq}}'}</code>는 출력 순서대로 이 번호부터 1씩 증가합니다.</p>
      </Section>
    </>
  );
}
