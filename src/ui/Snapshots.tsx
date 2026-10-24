import { useEffect, useState } from 'react';
import { locale, t } from '../i18n';
import { addSnapshot, deleteSnapshot, loadSnapshots, type Snapshot } from '../io/project';
import { migrateProject } from '../model/defaults';
import type { Project } from '../model/types';
import { useStore } from '../store';
import { Modal } from './controls';
import { Thumb } from './Dialogs';

/** Earlier states of the work in this browser: taken every 10 minutes of editing, before opening other work, and by hand. */
export function SnapshotsDialog({ onLoad }: { onLoad: (p: Project, name?: string) => void }) {
  const project = useStore((s) => s.project);
  const { close, notify } = useStore.getState();
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [name, setName] = useState('');
  const reload = () => loadSnapshots().then(setList);
  useEffect(() => { void reload(); }, []);
  const save = async () => {
    await addSnapshot(project, name.trim() || project.name, false);
    setName('');
    notify(t('지금 상태를 버전 기록에 저장했습니다.'));
    void reload();
  };
  const restore = (s: Snapshot) => {
    if (!confirm(t('"{name}" ({time}) 상태로 되돌릴까요?\n지금 상태는 버전 기록에 남습니다.', { name: s.name, time: new Date(s.at).toLocaleString(locale()) }))) return;
    onLoad(migrateProject(s.project));
    notify(t('버전 기록에서 되돌렸습니다.'));
    close();
  };
  return (
    <Modal title={t('버전 기록')} onClose={close} wide="xl">
      <p className="muted small">{t('작업하는 동안 10분마다, 그리고 다른 작업을 열기 전에 자동으로 저장합니다(최근 12개). 이 브라우저에만 있으니 오래 둘 작업은 파일로도 저장하세요.')}</p>
      <div className="btn-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('이름 (예: 인쇄 전 최종)')} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <button className="primary" onClick={() => void save()}>{t('지금 상태 저장')}</button>
      </div>
      {list && !list.length && <p className="muted">{t('아직 저장된 버전이 없습니다.')}</p>}
      <div className="gallery">
        {list?.map((s) => (
          <div key={s.id} className="card">
            <Thumb p={s.project} />
            <strong>{s.name}</strong>
            <span className="muted small">{new Date(s.at).toLocaleString(locale())} · {s.auto ? t('자동') : t('직접 저장')}</span>
            <span className="muted small">{t('{rows}행 · 디자인 {n}개', { rows: s.project.data.rows.length, n: s.project.designs.length })}</span>
            <span className="card-paper btn-row">
              <button className="primary small" onClick={() => restore(s)}>{t('되돌리기')}</button>
              <button className="small" onClick={async () => { await deleteSnapshot(s.id); void reload(); }}>{t('삭제')}</button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
