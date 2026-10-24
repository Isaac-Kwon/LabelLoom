import { useEffect, useRef, useState } from 'react';
import { registerFonts } from './io/fonts';
import { kvGet, kvSet, parseProject, pickFile } from './io/project';
import { decodeShare, readShareHash } from './io/share';
import { migrateProject } from './model/defaults';
import type { Project, Row } from './model/types';
import { QuickForm } from './ui/QuickPrint';

/** Quick print page (?quick, #q=…, or the editor's 빠른 출력 button): a template, its fields, a live preview, print. */

const KEY = 'quickTemplate'; // separate from the editor's autosave

export function QuickApp({ onEdit, start, onPrinted }: {
  onEdit: (p: Project | null) => void;
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
        try { use(await decodeShare(share.code)); } catch (e) { notify('링크를 읽을 수 없습니다: ' + (e as Error).message); }
        // the template is kept locally, so a refresh stays on this page without the long hash
        history.replaceState(null, '', location.pathname + '?quick');
      } else {
        const prev = await kvGet<Project>(KEY);
        if (prev) { try { use(migrateProject(prev)); } catch { /* ignore broken entry */ } }
      }
      setReady(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFile = async (f: File | null) => {
    if (!f) return;
    try { use(parseProject(await f.text())); notify(`템플릿을 불러왔습니다: ${f.name}`); } catch (e) { notify((e as Error).message); }
  };
  // recording only makes sense for the editor's own project, not another template opened here
  const fromEditor = !!onPrinted && !!start && project === start;
  const choose = async () => loadFile(await pickFile('.json,application/json'));

  return (
    <div className="quick-app"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={(e) => { e.preventDefault(); setDropping(false); void loadFile(e.dataTransfer.files[0] ?? null); }}>
      <header className="quick-bar">
        <strong>LabelLoom 빠른 출력</strong>
        {project && <span className="muted ellipsis">{project.name}</span>}
        <span className="spacer" />
        {fromEditor && <label className="check"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /><span>입력한 내용을 명단에 기록</span></label>}
        {project && <button onClick={choose}>다른 템플릿</button>}
        <button onClick={() => onEdit(project)}
          title={project ? '이 템플릿을 편집기에서 수정합니다' : '편집기를 엽니다'}>{project ? '✎ 편집기에서 수정' : '편집기 열기'}</button>
      </header>
      <main className="quick-main">
        {project ? <QuickForm key={loads} project={project} notify={notify} onPrinted={fromEditor && record ? onPrinted : undefined} />
          : ready && (
            <button className="quick-drop" onClick={choose}>
              <strong>템플릿 파일을 끌어다 놓거나 클릭해서 고르세요</strong>
              <span className="muted">LabelLoom에서 저장한 .labelloom.json 파일 · 공유받은 빠른 출력 링크로도 열 수 있습니다</span>
            </button>
          )}
      </main>
      {dropping && <div className="drop-overlay">템플릿 파일(.json)을 놓으세요</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
