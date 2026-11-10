import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Rgba } from '../core/scan'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Draws one page of a PDF onto a new canvas, `pxPerPt` pixels per point. */
export async function renderPdfPage(pdf: Uint8Array, pageIndex: number, pxPerPt: number) {
  const task = pdfjs.getDocument({ data: pdf.slice() })
  const doc = await task.promise
  try {
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: pxPerPt })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    return canvas
  } finally {
    void task.destroy()
  }
}

function canvasToRgba(src: CanvasImageSource, w: number, h: number, maxDim: number): Rgba {
  // Small pictures are enlarged a little: the page code reads far more reliably that way.
  const k = Math.min(2.5, maxDim / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * k)
  canvas.height = Math.round(h * k)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: d.data, width: d.width, height: d.height }
}

export interface ScanImage {
  label: string
  /** Pixels at a working size, and at a larger size to retry with if the first read fails. */
  get(maxDim: number): Promise<Rgba>
}

/** Turns a dropped file (photo, or a PDF from a scanner) into one image per page. */
export async function fileToImages(file: File): Promise<ScanImage[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const task = pdfjs.getDocument({ data: bytes.slice() })
    const n = (await task.promise).numPages
    void task.destroy()
    return Array.from({ length: n }, (_, i) => ({
      label: n > 1 ? `${file.name} (page ${i + 1})` : file.name,
      get: async (maxDim: number) => {
        const c = await renderPdfPage(bytes, i, maxDim / 800)
        return canvasToRgba(c, c.width, c.height, maxDim)
      },
    }))
  }
  return [
    {
      label: file.name,
      get: async (maxDim: number) => {
        const bmp = await createImageBitmap(file)
        try {
          return canvasToRgba(bmp, bmp.width, bmp.height, maxDim)
        } finally {
          bmp.close()
        }
      },
    },
  ]
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
