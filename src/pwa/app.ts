/**
 * Popsheet as an installed app: offline support (the service worker), the browser's install prompt, update
 * notices, and asking the browser to keep the teacher's data rather than clear it when space runs low.
 */

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface AppState {
  /** The browser offers its own install dialog (Chrome, Edge, Android). */
  canInstall: boolean
  /** Running as an installed app rather than in a browser tab. */
  installed: boolean
  /** iPhone and iPad Safari, which only installs from the Share menu. */
  iosHint: boolean
  /** A new release is downloaded and waiting for a reload. */
  updateReady: boolean
}

let prompt: InstallPrompt | null = null
let waiting: ServiceWorker | null = null
let listeners: (() => void)[] = []
let state: AppState = {
  canInstall: false,
  installed: false,
  iosHint: false,
  updateReady: false,
}

const set = (patch: Partial<AppState>) => {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export const appState = () => state
export function onAppState(cb: () => void) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Shows the browser's install dialog. */
export async function install() {
  if (!prompt) return
  const p = prompt
  prompt = null
  set({ canInstall: false })
  await p.prompt()
  const { outcome } = await p.userChoice
  if (outcome === 'accepted') set({ installed: true, iosHint: false })
}

/** Switches to the waiting release; the page reloads once it has taken over. */
export function applyUpdate() {
  if (!waiting) return location.reload()
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage('skip-waiting')
}

function watchForUpdates(reg: ServiceWorkerRegistration) {
  const found = (w: ServiceWorker | null) => {
    // Only an update when a worker already runs this page; the very first install needs no reload.
    if (w && navigator.serviceWorker.controller) {
      waiting = w
      set({ updateReady: true })
    }
  }
  found(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const w = reg.installing
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') found(w)
    })
  })
  // Look for a new release when the teacher comes back to the app, at most once an hour.
  let last = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last > 60 * 60 * 1000) {
      last = Date.now()
      void reg.update().catch(() => {})
    }
  })
}

export function startApp() {
  set({ installed: standalone(), iosHint: !standalone() && isIos() })
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    prompt = e as InstallPrompt
    set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    prompt = null
    set({ installed: true, canInstall: false, iosHint: false })
  })

  // Worksheets, classes and scans live only on this device; ask the browser not to clear them to free space.
  void navigator.storage?.persist?.().catch(() => {})

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then(watchForUpdates)
      .catch(() => {
        // Popsheet still works online without offline support.
      })
  }
}
