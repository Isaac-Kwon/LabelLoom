import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { registerFonts } from './io/fonts';
import { kvGet, kvSet, pickFile, PROJECT_ACCEPT, readProjectFile } from './io/project';
import { copyQuickLink, decodeShare, quickShareCode, readShareHash } from './io/share';
import { migrateProject } from './model/defaults';
import type { Project, Row } from './model/types';
import { InstallButton } from './pwa';
import { DropOverlay } from './ui/controls';
import { QuickForm } from './ui/QuickPrint';
import { LangSelect } from './ui/Toolbar';

/** Quick print page (?quick, #q=…, or the editor's 빠른 출력 button): a template, its fields, a live preview, print. */

const KEY = 'quickTemplate'; // separate from the editor's autosave

export function QuickApp({ onEdit, onBack, start, onPrinted }: {
  onEdit: (p: Project | null) => void;
  /** Esc: back to where the editor opened this page (only while showing the editor's own project) */
  onBack?: () => void;
  /** project handed over by the editor */
  start?: Project;
  /** record printed rows in the editor's data table */
  onPrinted?: (rows: Row[]) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [dropping, setDropping] = useState(false);
  const [loads, setLoads] = useState(0); // remount the form for each template
  const [record, setRecord] = useState(true);
  const timer = useRef(0);

  const notify = (msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(''), 2600);
  };

  const use = (p: Project) => {
    setProject(p);
    setLoads((n) => n + 1);
    void registerFonts(p);
    void kvSet(KEY, p);
  };

  useEffect(() => {
    (async () => {
      const share = readShareHash();
      if (start) {
        use(start);
      } else if (share) {
        try { use(await decodeShare(share.code)); } catch (e) { notify(t('링크를 읽을 수 없습니다: {error}', { error: (e as Error).message })); }
      } else {
        const prev = await kvGet<Project>(KEY);
        if (prev) { try { use(migrateProject(prev)); } catch { /* ignore broken entry */ } }
      }
      setReady(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the address always carries the template, so copying it from the address bar shares this page
  useEffect(() => {
    if (!project) return;
    let live = true;
    quickShareCode(project).then((code) => {
      if (!live) return;
      try { history.replaceState(null, '', `${location.pathname}?quick#q=${code}`); } catch { history.replaceState(null, '', location.pathname + '?quick'); }
    }).catch(() => { /* keep the current address */ });
    return () => { live = false; };
  }, [project]);

  const loadFile = async (f: File | null) => {
    if (!f) return;
    try { use(await readProjectFile(f)); notify(t('템플릿을 불러왔습니다: {name}', { name: f.name })); } catch (e) { notify((e as Error).message); }
  };
  // recording only makes sense for the editor's own project, not another template opened here
  const fromEditor = !!onPrinted && !!start && project === start;

  const canGoBack = !!onBack && !!start && project === start;
  useEffect(() => {
    if (!canGoBack) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onBack!(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [canGoBack, onBack]);
  const choose = async () => loadFile(await pickFile(PROJECT_ACCEPT));

  return (
    <div className="quick-app"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={(e) => { e.preventDefault(); setDropping(false); void loadFile(e.dataTransfer.files[0] ?? null); }}>
      <header className="quick-bar">
        <strong>LabelLoom {t('빠른 출력')}</strong>
        {project && <span className="muted ellipsis">{project.name}</span>}
        <span className="spacer" />
        {fromEditor && <label className="check"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /><span>{t('입력한 내용을 명단에 기록')}</span></label>}
        <LangSelect />
        <InstallButton />
        {project && <button onClick={async () => notify(await copyQuickLink(project))} title={t('이 템플릿으로 바로 빠른 출력 화면을 여는 링크 (명단은 포함하지 않음)')}>🔗 {t('링크 복사')}</button>}
        {project && <button onClick={choose}>{t('다른 템플릿')}</button>}
        <button onClick={() => onEdit(project)}
          title={project ? t('이 템플릿을 편집기에서 수정합니다') + (canGoBack ? t(' (Esc: 빠른 출력 창으로 돌아가기)') : '') : t('편집기를 엽니다')}>{project ? `✎ ${t('편집기에서 수정')}` : t('편집기 열기')}</button>
      </header>
      <main className="quick-main">
        {project ? <QuickForm key={loads} project={project} notify={notify} onPrinted={fromEditor && record ? onPrinted : undefined} />
          : ready && (
            <button className="quick-drop" onClick={choose}>
              <strong>{t('템플릿 파일을 끌어다 놓거나 클릭해서 고르세요')}</strong>
              <span className="muted">{t('LabelLoom에서 저장한 .labelloom.json · .labelloom.zip 파일 · 공유받은 빠른 출력 링크로도 열 수 있습니다')}</span>
            </button>
          )}
      </main>
      {dropping && <DropOverlay title={t('템플릿을 여기에 놓으세요')} kinds={['.labelloom.json', '.labelloom.zip']} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
