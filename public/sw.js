// Keeps a copy of the app so it opens offline and as an installed app.
// The copy is replaced only when the page asks for it (the update bar in src/pwa.tsx), never by a deploy alone.
const CACHE = 'labelloom-app';
const PAGE = './';
const FILES = [PAGE, 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // fill only what is missing, so a new sw.js keeps the version the user has
    await Promise.all(FILES.map(async (f) => { if (!(await c.match(f))) await c.add(new Request(f, { cache: 'reload' })); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(cached(PAGE, req));
  const name = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (name && FILES.includes(name)) e.respondWith(cached(name, req));
});

async function cached(key, req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await c.put(key, res.clone());
  return res;
}

// 'update': download every file again, and swap the copy only once all of them arrived
self.addEventListener('message', (e) => {
  if (e.data !== 'update') return;
  e.waitUntil((async () => {
    try {
      const got = await Promise.all(FILES.map(async (f) => {
        const r = await fetch(f, { cache: 'reload' });
        if (!r.ok) throw new Error(`${f}: ${r.status}`);
        return [f, r];
      }));
      const c = await caches.open(CACHE);
      await Promise.all(got.map(([f, r]) => c.put(f, r)));
      e.source?.postMessage('updated');
    } catch {
      e.source?.postMessage('update-failed');
    }
  })());
});
