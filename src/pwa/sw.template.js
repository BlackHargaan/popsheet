// Popsheet's service worker: keeps the app working offline once it has been opened.
// The build fills in the file lists below (see vite.config.ts), so each release gets a new worker.
//
// Only Popsheet's own files are cached here. Worksheets, classes and scans live in IndexedDB on the device and
// never pass through this worker; the handwriting model is cached by the reader itself.

const VERSION = /*VERSION*/ 'dev'
/** The app itself: cached when the worker installs, so Popsheet opens offline straight away. */
const PRECACHE = /*PRECACHE*/ []
/** Every file in this release. Large, rarely needed files (the handwriting runtime) are cached on first use. */
const ALL = new Set(/*ALL*/ [])

const SHELL = `popsheet-shell-${VERSION}`
const RUNTIME = 'popsheet-runtime'
const scoped = (path) => new URL(path, self.registration.scope).href
const relative = (url) => url.slice(self.registration.scope.length)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map(scoped))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('popsheet-shell-') && name !== SHELL) await caches.delete(name)
      }
      // Drop files cached on demand by earlier releases that this one no longer uses.
      const runtime = await caches.open(RUNTIME)
      for (const req of await runtime.keys()) {
        if (!ALL.has(relative(req.url))) await runtime.delete(req)
      }
      await self.clients.claim()
    })(),
  )
})

// The page asks for this when the teacher chooses to switch to a new release.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return
  if (req.mode === 'navigate') {
    // Popsheet is one page (routes live after the #), so every visit gets the cached page.
    event.respondWith(caches.match(scoped('index.html')).then((hit) => hit ?? fetch(req)))
    return
  }
  const path = relative(req.url.split(/[?#]/)[0])
  if (!ALL.has(path)) return
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(RUNTIME).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
