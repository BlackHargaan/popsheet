import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { GrayImage, Rgba } from '../core/scan'

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

/** Resolution of saved page images: 2 pixels per point is 144 dpi, plenty to read handwriting. */
export const SCAN_PPP = 2

function grayCanvas(img: GrayImage) {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const out = new ImageData(img.width, img.height)
  for (let i = 0; i < img.data.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = img.data[i]
    out.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  return canvas
}

/** Compresses a greyscale page for storage (WebP where the browser can make it, else JPEG). */
export async function grayToBlob(img: GrayImage): Promise<Blob> {
  const canvas = grayCanvas(img)
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82))
  const webp = await encode('image/webp')
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await encode('image/jpeg')
  if (!jpeg) throw new Error('Could not save the page image.')
  return jpeg
}

/** Cuts a rectangle (in page points) out of a saved page image. */
export async function cropScan(image: Blob, ppp: number, r: { x: number; y: number; width: number; height: number }) {
  const sx = Math.max(0, Math.floor(r.x * ppp))
  const sy = Math.max(0, Math.floor(r.y * ppp))
  return createImageBitmap(image, sx, sy, Math.max(1, Math.ceil(r.width * ppp)), Math.max(1, Math.ceil(r.height * ppp)))
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
