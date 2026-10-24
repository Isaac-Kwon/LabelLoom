import { saveProjectZip, serialize } from '../io/project';
import { download, safeName } from '../io/export';
import { getLang, LANGS, m, setLang, t } from '../i18n';
import type { ObjType } from '../model/types';
import { InstallButton } from '../pwa';
import { pickDesign } from '../render/resolve';
import { act, currentDesign, useStore, type Tool } from '../store';

const PX_PER_MM_100 = 96 / 25.4;
const ISSUES_URL = 'https://github.com/Isaac-Kwon/LabelLoom/issues';

const TOOLS = [
  { t: 'select', icon: '↖', label: m('선택'), key: 'V' },
  { t: 'text', icon: 'T', label: m('텍스트'), key: 'T' },
  { t: 'rect', icon: '▭', label: m('사각형'), key: 'R' },
  { t: 'ellipse', icon: '◯', label: m('원'), key: 'O' },
  { t: 'triangle', icon: '△', label: m('삼각형'), key: '' },
  { t: 'line', icon: '╱', label: m('선'), key: 'L' },
  { t: 'barcode', icon: '▥', label: m('바코드'), key: 'B' },
  { t: 'qr', icon: '▦', label: m('QR 코드'), key: 'Q' },
  { t: 'image', icon: '🖼', label: m('이미지'), key: 'I' },
  { t: 'svg', icon: '✒', label: m('SVG'), key: '' },
  { t: 'table', icon: '▤', label: m('표'), key: '' },
] satisfies { t: Tool; icon: string; label: string; key: string }[];

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
      <div className="brand" title={`LabelLoom — ${t('라벨·명찰 디자이너')}`}><span className="logo">◧</span> LabelLoom</div>
      <div className="dropdown" data-tour="file-menu">
        <button>{t('파일')} ▾</button>
        <div className="menu">
          <button onClick={() => s.open('start')}>{t('새로 만들기 · 템플릿…')}</button>
          <button onClick={onOpen}>{t('열기…')} <kbd>Ctrl+O</kbd></button>
          <button onClick={() => onSave(false)}>{t('저장')} <kbd>Ctrl+S</kbd></button>
          <button onClick={() => onSave(true)}>{t('다른 이름으로 저장…')} <kbd>Ctrl+Shift+S</kbd></button>
          <button onClick={() => download(new Blob([serialize(project, { includeData: false })], { type: 'application/json' }), safeName(project.name) + t('-디자인만') + '.labelloom.json')}>{t('디자인만 저장 (데이터 제외)')}</button>
          <button onClick={async () => { try { s.notify(t('저장했습니다: {name}', { name: await saveProjectZip(project) })); } catch (e) { s.notify((e as Error).message); } }}
            title={t('그림과 글꼴을 원본 파일 그대로 project.json과 함께 ZIP으로 묶습니다. 열기로 다시 불러올 수 있습니다')}>{t('ZIP으로 저장 (그림·글꼴 원본 포함)')}</button>
          <hr />
          <button onClick={() => s.open('replace')}>{t('찾아 바꾸기…')} <kbd>Ctrl+H</kbd></button>
          <button onClick={() => s.open('remap')}>{t('열 다시 연결…')}</button>
          <hr />
          <button onClick={() => s.open('share')}>{t('링크로 공유…')}</button>
          <button onClick={() => s.open('fonts')}>{t('글꼴 관리…')}</button>
          <button onClick={() => s.open('calibration')}>{t('프린터 정렬 보정…')}</button>
          <hr />
          <LangMenu />
          <hr />
          <button onClick={() => s.open('help')}>{t('튜토리얼·도움말')} <kbd>F1</kbd></button>
          <button onClick={() => s.open('shortcuts')}>{t('단축키')} <kbd>?</kbd></button>
          <button onClick={() => s.open('about')}>{t('프로그램 정보…')}</button>
          <button onClick={() => window.open(ISSUES_URL, '_blank', 'noopener')} title={t('GitHub 이슈 페이지에서 질문·버그 제보·기능 요청')}>{t('문의사항 (GitHub Issue)')} ↗</button>
        </div>
      </div>
      <input className="project-name" value={project.name} title={fileName || t('저장되지 않음')}
        onChange={(e) => s.live((p) => ({ ...p, name: e.target.value }))} onFocus={() => s.checkpoint()} />
      <div className="tool-group" data-tour="undo">
        <button className="icon" disabled={!canUndo} onClick={s.undo} title={`${t('실행 취소')} (Ctrl+Z)`}>↶</button>
        <button className="icon" disabled={!canRedo} onClick={s.redo} title={`${t('다시 실행')} (Ctrl+Shift+Z)`}>↷</button>
      </div>
      <div className="tool-group tools">
        {TOOLS.map((x) => (
          <button key={x.t} data-tour={`tool-${x.t}`} className={`tool ${tool === x.t ? 'on' : ''}`} title={`${t(x.label)}${x.key ? ` (${x.key})` : ''}`}
            onClick={() => (x.t === 'select' ? s.setTool('select') : s.setTool(x.t as ObjType))}>
            <span className="tool-icon">{x.icon}</span><span className="tool-label">{t(x.label)}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <div className="tool-group">
        <button className="icon" onClick={() => s.setZoom(zoom / 1.25)} title={t('축소')}>−</button>
        <button className="zoom" onClick={() => window.dispatchEvent(new Event('labelloom:fit'))} title={t('화면에 맞추기 (Ctrl+0) · 100% = 실제 크기')}>{Math.round((zoom / PX_PER_MM_100) * 100)}%</button>
        <button className="icon" onClick={() => s.setZoom(zoom * 1.25)} title={t('확대')}>＋</button>
        <button className="icon" onClick={() => window.dispatchEvent(new Event('labelloom:fit-width'))} title={t('폭에 맞추고 가운데로 (Ctrl+Shift+0)')}>↔</button>
      </div>
      <button onClick={() => s.open('share')} title={t('디자인을 링크로 공유 (서버에 저장되지 않음)')}>{t('링크 공유')}</button>
      <InstallButton />
      <button data-tour="quick" onClick={() => s.open('quick')} title={t('필요한 값만 입력하고 미리보기를 보며 바로 인쇄')}>{t('빠른 출력')}</button>
      <button data-tour="reprint" onClick={() => s.open('reprint')} title={t('이름 검색 후 1장 바로 인쇄, 현장 등록')}>{t('현장 재발행')}</button>
      <button className="primary" data-tour="export" onClick={() => s.open('export')} title="Ctrl+P">{t('인쇄 · 내보내기')}</button>
    </header>
  );
}

/** Language items for a menu; the label stays readable whatever the current language. */
function LangMenu() {
  const cur = getLang();
  return <>
    {LANGS.map((l) => (
      <button key={l.value} onClick={() => setLang(l.value)} className={l.value === cur ? 'on' : ''}>
        <span>🌐 {l.label}</span>{l.value === cur && <span>✓</span>}
      </button>
    ))}
  </>;
}

/** Language picker for places without a menu (quick print page). */
export function LangSelect() {
  return (
    <select value={getLang()} onChange={(e) => setLang(e.target.value as typeof LANGS[number]['value'])} title="Language · 언어 · Lingua · Langue" aria-label="Language">
      {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
    </select>
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
        <button className="icon small" title={t('새 디자인')} onClick={() => act.addDesign()}>＋</button>
      </div>
      <div className="seg">
        <button className={side === 'front' ? 'on' : ''} onClick={() => s.setDesign(designId, 'front')}>{t('앞면')}</button>
        <button className={side === 'back' ? 'on' : ''} onClick={() => s.setDesign(designId, 'back')} title={t('양면 인쇄용 뒷면')}>{t('뒷면')}{design.back?.length ? '' : ' ·'}</button>
      </div>
      <span className="spacer" />
      {rows.length > 0 ? (
        <div className="row-nav" data-tour="row-nav" title={t('미리볼 데이터 행 (PageUp/PageDown)')}>
          <span className="muted small">{t('미리보기')}</span>
          <button className="icon small" disabled={currentRow <= 0} onClick={() => s.setCurrentRow(currentRow - 1)}>◀</button>
          <input type="number" min={1} max={rows.length} value={currentRow + 1} onChange={(e) => s.setCurrentRow(Math.max(0, Math.min(rows.length - 1, (parseInt(e.target.value, 10) || 1) - 1)))} />
          <span className="muted small">/ {rows.length}</span>
          <button className="icon small" disabled={currentRow >= rows.length - 1} onClick={() => s.setCurrentRow(currentRow + 1)}>▶</button>
          {ruled && ruled.id !== designId && (
            <button className="link small" onClick={() => s.setDesign(ruled.id)} title={t('이 행은 규칙에 따라 다른 디자인으로 출력됩니다')}>{t('→ 이 행은 "{name}"', { name: ruled.name })}</button>
          )}
        </div>
      ) : <span className="muted small">{t('데이터 없음 — 디자인 그대로 출력')}</span>}
    </div>
  );
}
