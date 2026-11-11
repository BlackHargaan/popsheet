/// <reference lib="webworker" />
// Reads handwritten answers on this device, in the background so the page stays responsive.
// Only the model itself is downloaded (once, then cached by the browser); the answer images never leave
// the device. The ONNX runtime is served by Popsheet rather than a CDN.
import { RawImage, env, pipeline } from '@huggingface/transformers'
import type { ImageToTextPipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

export const MODEL = 'Xenova/trocr-small-handwritten'

const abs = (u: string) => new URL(u, self.location.href).href
env.allowLocalModels = false
env.backends.onnx.wasm!.wasmPaths = { mjs: abs(ortMjs), wasm: abs(ortWasm) }

export type ReaderRequest = { id: number; image: Blob }
export type ReaderMessage =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number | null; message: string }

const post = (m: ReaderMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

let reader: Promise<ImageToTextPipeline> | null = null
function load() {
  reader ??= (pipeline('image-to-text', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
    },
  }) as Promise<ImageToTextPipeline>).then((r) => {
    post({ type: 'ready' })
    return r
  })
  return reader
}

/**
 * Prepares an answer for the model: flattened onto white paper (a transparent background would read as
 * black) and cropped close around the ink with a margin. The model reads a line of writing; empty paper
 * around the answer makes it invent extra words. Returns null when there is no ink at all.
 */
async function prepare(blob: Blob): Promise<OffscreenCanvas | null> {
  const bmp = await createImageBitmap(blob)
  const { width: w, height: h } = bmp
  const src = new OffscreenCanvas(w, h)
  const g = src.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  g.drawImage(bmp, 0, 0)
  bmp.close()
  const px = g.getImageData(0, 0, w, h).data
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10
  const sorted = Uint8Array.from(gray).sort()
  const ink = sorted[Math.floor(sorted.length * 0.6)] - 70
  // Ink rows and columns, ignoring a stray dot by asking for 2 ink pixels per line.
  const rows = new Uint16Array(h)
  const cols = new Uint16Array(w)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (gray[y * w + x] < ink) {
        rows[y]++
        cols[x]++
      }
  const first = (a: Uint16Array) => a.findIndex((v) => v >= 2)
  const last = (a: Uint16Array) => a.length - 1 - [...a].reverse().findIndex((v) => v >= 2)
  const y0 = first(rows)
  const x0 = first(cols)
  if (y0 < 0 || x0 < 0) return null
  const y1 = last(rows)
  const x1 = last(cols)
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const pad = Math.max(4, Math.round(ch * 0.25))
  const out = new OffscreenCanvas(cw + 2 * pad, ch + 2 * pad)
  const og = out.getContext('2d')!
  og.fillStyle = '#fff'
  og.fillRect(0, 0, out.width, out.height)
  og.drawImage(src, x0, y0, cw, ch, pad, pad, cw, ch)
  return out
}

// One answer at a time, in order.
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<ReaderRequest>) => {
  const { id, image } = e.data
  queue = queue.then(async () => {
    try {
      const run = await load()
      const page = await prepare(image)
      if (!page) return post({ type: 'result', id, text: '' })
      const input = await RawImage.fromBlob(await page.convertToBlob({ type: 'image/png' }))
      const out = (await run(input, { max_new_tokens: 24, no_repeat_ngram_size: 3 } as never)) as { generated_text: string }[]
      post({ type: 'result', id, text: (out[0]?.generated_text ?? '').trim() })
    } catch (err) {
      reader = null
      post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
    }
  })
}
