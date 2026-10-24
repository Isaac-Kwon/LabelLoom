import { serialize } from '../io/project';
import { download, safeName } from '../io/export';
import type { ObjType } from '../model/types';
import { pickDesign } from '../render/resolve';
import { act, currentDesign, useStore, type Tool } from '../store';

const PX_PER_MM_100 = 96 / 25.4;

const TOOLS: { t: Tool; icon: string; label: string; key: string }[] = [
  { t: 'select', icon: '↖', label: '선택', key: 'V' },
  { t: 'text', icon: 'T', label: '텍스트', key: 'T' },
  { t: 'rect', icon: '▭', label: '사각형', key: 'R' },
  { t: 'ellipse', icon: '◯', label: '원', key: 'O' },
  { t: 'triangle', icon: '△', label: '삼각형', key: '' },
  { t: 'line', icon: '╱', label: '선', key: 'L' },
  { t: 'barcode', icon: '▥', label: '바코드', key: 'B' },
  { t: 'qr', icon: '▦', label: 'QR 코드', key: 'Q' },
  { t: 'image', icon: '🖼', label: '이미지', key: 'I' },
  { t: 'svg', icon: '✒', label: 'SVG', key: '' },
  { t: 'table', icon: '▤', label: '표', key: '' },
];

export function Toolbar({ onOpen, onSave }: { onOpen: () => void; onSave: (saveAs?: boolean) => void }) {
  const project = useStore((s) => s.project);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const fileName = useStore((s) => s.fileName);
  const s = useStore.getState();

  return (
    <header className="topbar">
      <div className="brand" title="LabelLoom — 라벨·명찰 디자이너"><span className="logo">◧</span> LabelLoom</div>
      <div className="dropdown">
        <button>파일 ▾</button>
        <div className="menu">
          <button onClick={() => s.open('start')}>새로 만들기 · 템플릿…</button>
          <button onClick={onOpen}>열기… <kbd>Ctrl+O</kbd></button>
          <button onClick={() => onSave(false)}>저장 <kbd>Ctrl+S</kbd></button>
          <button onClick={() => onSave(true)}>다른 이름으로 저장… <kbd>Ctrl+Shift+S</kbd></button>
          <button onClick={() => download(new Blob([serialize(project, { includeData: false })], { type: 'application/json' }), safeName(project.name) + '-디자인만.labelloom.json')}>디자인만 저장 (데이터 제외)</button>
          <hr />
          <button onClick={() => s.open('share')}>링크로 공유…</button>
          <button onClick={() => s.open('fonts')}>글꼴 관리…</button>
          <button onClick={() => s.open('calibration')}>프린터 정렬 보정…</button>
          <hr />
          <button onClick={() => s.open('shortcuts')}>단축키 <kbd>?</kbd></button>
        </div>
      </div>
      <input className="project-name" value={project.name} title={fileName || '저장되지 않음'}
        onChange={(e) => s.live((p) => ({ ...p, name: e.target.value }))} onFocus={() => s.checkpoint()} />
      <div className="tool-group">
        <button className="icon" disabled={!canUndo} onClick={s.undo} title="실행 취소 (Ctrl+Z)">↶</button>
        <button className="icon" disabled={!canRedo} onClick={s.redo} title="다시 실행 (Ctrl+Shift+Z)">↷</button>
      </div>
      <div className="tool-group tools">
        {TOOLS.map((x) => (
          <button key={x.t} className={`tool ${tool === x.t ? 'on' : ''}`} title={`${x.label}${x.key ? ` (${x.key})` : ''}`}
            onClick={() => (x.t === 'select' ? s.setTool('select') : s.setTool(x.t as ObjType))}>
            <span className="tool-icon">{x.icon}</span><span className="tool-label">{x.label}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <div className="tool-group">
        <button className="icon" onClick={() => s.setZoom(zoom / 1.25)} title="축소">−</button>
        <button className="zoom" onClick={() => window.dispatchEvent(new Event('labelloom:fit'))} title="화면에 맞추기 (Ctrl+0) · 100% = 실제 크기">{Math.round((zoom / PX_PER_MM_100) * 100)}%</button>
        <button className="icon" onClick={() => s.setZoom(zoom * 1.25)} title="확대">＋</button>
      </div>
      <button onClick={() => s.open('quick')} title="필요한 값만 입력하고 미리보기를 보며 바로 인쇄">빠른 출력</button>
      <button onClick={() => s.open('reprint')} title="이름 검색 후 1장 바로 인쇄, 현장 등록">현장 재발행</button>
      <button className="primary" onClick={() => s.open('export')} title="Ctrl+P">인쇄 · 내보내기</button>
    </header>
  );
}

export function CanvasBar() {
  const project = useStore((s) => s.project);
  const designId = useStore((s) => s.designId);
  const side = useStore((s) => s.side);
  const currentRow = useStore((s) => s.currentRow);
  const s = useStore.getState();
  const rows = project.data.rows;
  const design = currentDesign({ project, designId });
  const row = rows[currentRow];
  const ruled = row && project.designs.length > 1 ? pickDesign(project, row) : null;
  return (
    <div className="canvas-bar">
      <div className="design-tabs">
        {project.designs.map((d) => (
          <button key={d.id} className={d.id === designId ? 'on' : ''} onClick={() => s.setDesign(d.id)}>{d.name}</button>
        ))}
        <button className="icon small" title="새 디자인" onClick={() => act.addDesign()}>＋</button>
      </div>
      <div className="seg">
        <button className={side === 'front' ? 'on' : ''} onClick={() => s.setDesign(designId, 'front')}>앞면</button>
        <button className={side === 'back' ? 'on' : ''} onClick={() => s.setDesign(designId, 'back')} title="양면 인쇄용 뒷면">뒷면{design.back?.length ? '' : ' ·'}</button>
      </div>
      <span className="spacer" />
      {rows.length > 0 ? (
        <div className="row-nav" title="미리볼 데이터 행 (PageUp/PageDown)">
          <span className="muted small">미리보기</span>
          <button className="icon small" disabled={currentRow <= 0} onClick={() => s.setCurrentRow(currentRow - 1)}>◀</button>
          <input type="number" min={1} max={rows.length} value={currentRow + 1} onChange={(e) => s.setCurrentRow(Math.max(0, Math.min(rows.length - 1, (parseInt(e.target.value, 10) || 1) - 1)))} />
          <span className="muted small">/ {rows.length}</span>
          <button className="icon small" disabled={currentRow >= rows.length - 1} onClick={() => s.setCurrentRow(currentRow + 1)}>▶</button>
          {ruled && ruled.id !== designId && (
            <button className="link small" onClick={() => s.setDesign(ruled.id)} title="이 행은 규칙에 따라 다른 디자인으로 출력됩니다">→ 이 행은 "{ruled.name}"</button>
          )}
        </div>
      ) : <span className="muted small">데이터 없음 — 디자인 그대로 출력</span>}
    </div>
  );
}
