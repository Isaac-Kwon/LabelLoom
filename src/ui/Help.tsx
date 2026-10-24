import { useState } from 'react';
import { t } from '../i18n';
import type { Project } from '../model/types';
import { useStore } from '../store';
import { docUrl, LESSONS, lessonProject, stepText } from '../tutorial/lessons';
import { Modal } from './controls';

/** 튜토리얼·도움말: the lessons' steps to read, with their example and web page. */
export function HelpDialog({ onLoad }: { onLoad: (p: Project) => void }) {
  const { close, open } = useStore.getState();
  const [id, setId] = useState(LESSONS[0].id);
  const lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
  return (
    <Modal title={t('튜토리얼·도움말')} onClose={close} wide footer={<>
      <button onClick={() => open('shortcuts')}>{t('단축키')} <kbd>?</kbd></button>
      <a href={docUrl()} target="_blank" rel="noreferrer">{t('웹 문서 전체')} ↗</a>
      <span className="spacer" />
      <button onClick={close}>{t('닫기')}</button>
    </>}>
      <div className="help">
        <nav className="help-nav">
          {LESSONS.map((l, i) => (
            <button key={l.id} className={l.id === id ? 'on' : ''} onClick={() => setId(l.id)}>{i + 1}. {t(l.title)}</button>
          ))}
        </nav>
        <div className="help-body">
          <h3>{t(lesson.title)}</h3>
          <p className="muted small">{t(lesson.summary)}</p>
          <ol className="help-steps">
            {lesson.steps.map((st, i) => <li key={i}>{stepText(st)}</li>)}
          </ol>
          <div className="btn-row">
            <button className="primary" onClick={() => { onLoad(lessonProject(lesson)); close(); }}>{t('예제 열기')}</button>
            <a href={docUrl(lesson)} target="_blank" rel="noreferrer">{t('웹에서 자세히 보기')} ↗</a>
          </div>
        </div>
      </div>
    </Modal>
  );
}
