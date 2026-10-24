import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { Project } from './model/types';
import { QuickApp } from './QuickApp';
import './styles.css';

const quickUrl = () => new URLSearchParams(location.search).has('quick') || /^#q=/.test(location.hash);

/** Quick print page or the editor; switching to the editor keeps the page and hands over the template. */
function Root() {
  const [mode, setMode] = useState<{ quick: true } | { quick: false; initial?: Project }>(() => (quickUrl() ? { quick: true } : { quick: false }));
  if (mode.quick) {
    return <QuickApp onEdit={(p) => {
      history.replaceState(null, '', location.pathname);
      setMode({ quick: false, initial: p ?? undefined });
    }} />;
  }
  return <App initial={mode.initial} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
