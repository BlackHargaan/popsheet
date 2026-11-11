import type { ReaderMessage } from './reader.worker'

/** Rough download size of the handwriting model, for telling the teacher before the first use. */
export const MODEL_DOWNLOAD_MB = 70

export interface DownloadProgress {
  loaded: number
  total: number
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()
const files = new Map<string, DownloadProgress>()
let listeners: ((p: DownloadProgress | null) => void)[] = []

function start() {
  if (worker) return worker
  worker = new Worker(new URL('./reader.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<ReaderMessage>) => {
    const m = e.data
    if (m.type === 'progress') {
      files.set(m.file, { loaded: m.loaded, total: m.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      for (const l of listeners) l({ loaded, total })
    } else if (m.type === 'ready') {
      for (const l of listeners) l(null)
    } else if (m.type === 'result') {
      pending.get(m.id)?.resolve(m.text)
      pending.delete(m.id)
    } else if (m.type === 'error') {
      if (m.id !== null) {
        pending.get(m.id)?.reject(new Error(m.message))
        pending.delete(m.id)
      }
    }
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The handwriting reader stopped.'))
    pending.clear()
    worker = null
  }
  return worker
}

/** Reads the handwriting in one answer image. The first call downloads the model. */
export function readHandwriting(image: Blob): Promise<string> {
  const w = start()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, image })
  })
}

/** Model download progress (null once it is ready). Returns an unsubscribe function. */
export function onDownloadProgress(cb: (p: DownloadProgress | null) => void) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

/** True once the browser has the model cached, so reading will not need a download. */
export async function modelIsCached(): Promise<boolean> {
  try {
    if (!('caches' in self)) return false
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    return keys.some((k) => k.url.includes('trocr-small-handwritten'))
  } catch {
    return false
  }
}
