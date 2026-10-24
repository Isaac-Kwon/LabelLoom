import { Fragment, StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getLang, subscribeLang } from './i18n';
import { saveAutosave } from './io/project';
import { setupPwa, UpdateBar } from './pwa';
import type { Project, Row } from './model/types';
import { QuickApp } from './QuickApp';
import { useStore } from './store';
import './styles.css';

const quickUrl = () => new URLSearchParams(location.search).has('quick') || /^#q=/.test(location.hash);

type Mode = { quick: true; from?: Project } | { quick: false; initial?: Project };

/** Quick print page or the editor. Both switch in place: the editor hands its project over, and gets back a different template only if one was opened. */
function Root() {
  const [mode, setMode] = useState<Mode>(() => (quickUrl() ? { quick: true } : { quick: false }));
  // a new language remounts the screens; the work stays in the store
  const lang = useSyncExternalStore(subscribeLang, getLang);

  const toQuick = () => {
    const p = useStore.getState().project;
    void saveAutosave(p);
    history.replaceState(null, '', location.pathname + '?quick');
    setMode({ quick: true, from: p });
  };

  const record = (rows: Row[]) => {
    const s = useStore.getState();
    const now = new Date().toISOString();
    s.commit((p) => ({ ...p, data: { columns: [...new Set([...p.data.columns, ...rows.flatMap((r) => Object.keys(r.values))])], rows: [...p.data.rows, ...rows.map((r) => ({ ...r, printed: now }))] } }));
    void saveAutosave(useStore.getState().project);
  };

  if (mode.quick) {
    const from = mode.from;
    return <Fragment key={lang}>
      <UpdateBar />
      <QuickApp start={from} onPrinted={from ? record : undefined} onEdit={(p) => {
        history.replaceState(null, '', location.pathname);
        setMode({ quick: false, initial: p && p !== from ? p : undefined });
      }} onBack={from && (() => {
        // back to the editor with the quick print dialog it came from
        history.replaceState(null, '', location.pathname);
        setMode({ quick: false });
        useStore.getState().open('quick');
      })} />
    </Fragment>;
  }
  return <Fragment key={lang}>
    <UpdateBar beforeReload={() => saveAutosave(useStore.getState().project)} />
    <App initial={mode.initial} onQuick={toQuick} />
  </Fragment>;
}

setupPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
