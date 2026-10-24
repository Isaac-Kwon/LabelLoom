import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from './ui/controls';

/** Installing the page as an app, and the update bar for the copy that public/sw.js keeps. */

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let offer: InstallPrompt | null = null; // Chromium's install prompt, usable once
let installed = false;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const web = import.meta.env.PROD && /^https?:$/.test(location.protocol) && isSecureContext;

/** Call before the first render, so the browser's install offer is not missed. */
export function setupPwa() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e as InstallPrompt; changed(); });
  addEventListener('appinstalled', () => { offer = null; installed = true; changed(); });
  if (web && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

/* ---------- install ---------- */

const ua = navigator.userAgent;
const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
type How = 'ios' | 'safari' | 'edge' | 'chrome' | 'android';
const HOW: How | null = !web ? null
  : ios ? 'ios'
  : /Edg\//.test(ua) ? 'edge'
  : /Android/.test(ua) ? 'android'
  : /Chrome\/|Chromium\//.test(ua) ? 'chrome'
  : /Safari\//.test(ua) ? 'safari'
  : null; // desktop Firefox cannot install sites

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const STEPS: Record<How, { title: string; steps: string[] }> = {
  ios: { title: 'iPhone · iPad', steps: ['Safari 아래(또는 위)의 공유 버튼 (□↑)을 누릅니다.', "목록에서 '홈 화면에 추가'를 고릅니다.", "'추가'를 누르면 홈 화면에 LabelLoom 아이콘이 생깁니다."] },
  safari: { title: 'Mac Safari', steps: ["메뉴 막대에서 '파일' → 'Dock에 추가…'를 고릅니다. (macOS Sonoma · Safari 17 이상)", "'추가'를 누르면 Dock과 응용 프로그램 폴더에 LabelLoom이 생깁니다."] },
  edge: { title: 'Microsoft Edge', steps: ["주소 표시줄 오른쪽의 '앱 사용 가능' 아이콘을 누르거나,", "오른쪽 위 ⋯ 메뉴 → '앱' → '이 사이트를 앱으로 설치'를 고릅니다.", '설치하면 시작 메뉴 · 바탕 화면 · 작업 표시줄에 고정할 수 있습니다.'] },
  chrome: { title: 'Chrome', steps: ['주소 표시줄 오른쪽의 설치 아이콘(⊕)을 누르거나,', "오른쪽 위 ⋮ 메뉴 → '전송, 저장, 공유' → '페이지를 앱으로 설치…'를 고릅니다."] },
  android: { title: 'Android', steps: ["브라우저 메뉴(⋮)에서 '앱 설치' 또는 '홈 화면에 추가'를 고릅니다."] },
};

/** "앱으로 설치": the browser's own prompt where there is one (Chrome, Edge), otherwise how to do it by hand (Safari). */
export function InstallButton() {
  const prompt = useSyncExternalStore(subscribe, () => offer);
  const done = useSyncExternalStore(subscribe, () => installed);
  const [help, setHelp] = useState(false);
  if (!HOW || done || standalone()) return null;

  const install = async () => {
    if (!prompt) { setHelp(true); return; }
    offer = null;
    changed();
    await prompt.prompt();
    await prompt.userChoice; // 'accepted' also fires appinstalled
  };

  const how = STEPS[HOW];
  return (
    <>
      <button onClick={install} title="LabelLoom을 바탕 화면 · 홈 화면에 앱으로 추가해 독립 창으로 씁니다">⤓ 앱으로 설치</button>
      {help && (
        <Modal title="앱으로 설치" onClose={() => setHelp(false)} footer={<><span className="spacer" /><button className="primary" onClick={() => setHelp(false)}>확인</button></>}>
          <p style={{ margin: 0 }}>LabelLoom을 독립된 앱 창으로 쓸 수 있습니다. 설치한 앱은 지금 버전을 저장해 두어 인터넷 없이도 열리고, 새 버전이 나오면 위쪽에 알림이 뜹니다.</p>
          <strong>{how.title}</strong>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>{how.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {(HOW === 'edge' || HOW === 'chrome') && <p className="muted small" style={{ margin: 0 }}>메뉴에 설치 항목 대신 '앱에서 열기'가 보이면 이미 설치되어 있는 것입니다.</p>}
        </Modal>
      )}
    </>
  );
}

/* ---------- update ---------- */

const SKIP = 'labelloom.skipUpdate'; // the build the user asked not to hear about again
const CHECK_EVERY = 30 * 60 * 1000;
const readSkip = () => { try { return localStorage.getItem(SKIP); } catch { return null; } };
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

/** Ask the service worker to download the new version into its copy; true when it did. */
function refreshCopy(sw: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const on = (e: MessageEvent) => {
      if (e.data !== 'updated' && e.data !== 'update-failed') return;
      navigator.serviceWorker.removeEventListener('message', on);
      resolve(e.data === 'updated');
    };
    navigator.serviceWorker.addEventListener('message', on);
    sw.postMessage('update');
  });
}

/** Bar on top of the page when a newer build is deployed. The kept copy stays until "지금 업데이트". */
export function UpdateBar({ beforeReload }: { beforeReload?: () => Promise<unknown> }) {
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const closed = useRef(''); // closed for this session

  useEffect(() => {
    if (!web) return;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build?: string };
        if (build && build !== __BUILD_TIME__ && build !== closed.current && build !== readSkip()) setNext(build);
      } catch { /* offline */ }
    };
    void check();
    const onShow = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onShow);
    const t = setInterval(check, CHECK_EVERY);
    return () => { document.removeEventListener('visibilitychange', onShow); clearInterval(t); };
  }, []);

  if (!next) return null;

  const update = async () => {
    setBusy(true);
    setFailed(false);
    await beforeReload?.().catch(() => {});
    const sw = navigator.serviceWorker?.controller;
    if (!sw || (await refreshCopy(sw))) { location.reload(); return; }
    setBusy(false);
    setFailed(true);
  };
  const close = () => { closed.current = next; setNext(null); };
  const skip = () => { try { localStorage.setItem(SKIP, next); } catch { /* private mode */ } close(); };

  return (
    <div className="update-bar" role="status">
      <span><strong>새 버전이 있습니다</strong> <span className="muted">· {fmt(next)} 빌드 (지금 {fmt(__BUILD_TIME__)})</span></span>
      {failed && <span className="err">새 버전을 받지 못했습니다. 인터넷 연결을 확인하세요.</span>}
      <span className="spacer" />
      <button className="primary" disabled={busy} onClick={update}>{busy ? '받는 중…' : '지금 업데이트'}</button>
      <button className="link" onClick={skip} title="이 버전은 다시 알리지 않습니다. 그 다음 새 버전이 나오면 다시 알려 드립니다.">다음부터 표시 안 함</button>
      <button className="icon" onClick={close} title="닫기 (다음에 열 때 다시 알림)" aria-label="닫기">✕</button>
    </div>
  );
}
