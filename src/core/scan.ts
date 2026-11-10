import jsQR from 'jsqr'
import {
  BUBBLE_R,
  FID_SIZE,
  bubbleCenter,
  decodePageCode,
  fiducials,
  qrModuleCorners,
  questionBox,
} from './layout'
import type { Pt } from './layout'
import type { Mark, PageSize, Question } from './types'

export interface Rgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface Gray {
  data: Uint8Array
  width: number
  height: number
}

export type Homography = number[] // 9 numbers, row-major, page pts -> image px

export class ScanError extends Error {}

function toGray(img: Rgba): Gray {
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8
  }
  return { data: out, width: img.width, height: img.height }
}

function sample(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return 255
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, g.width - 1)
  const y1 = Math.min(y0 + 1, g.height - 1)
  const fx = x - x0
  const fy = y - y0
  const d = g.data
  const w = g.width
  return (
    d[y0 * w + x0] * (1 - fx) * (1 - fy) +
    d[y0 * w + x1] * fx * (1 - fy) +
    d[y1 * w + x0] * (1 - fx) * fy +
    d[y1 * w + x1] * fx * fy
  )
}

export function applyH(h: Homography, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8]
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }
}

/** Homography through four point pairs (or the least-squares fit through more). */
export function solveHomography(src: Pt[], dst: Pt[]): Homography {
  const rows: number[][] = []
  for (let i = 0; i < src.length; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  const n = 8
  let a = rows
  if (rows.length > n) {
    // Normal equations.
    a = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    )
  }
  for (let c = 0; c < n; c++) {
    let best = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[best][c])) best = r
    ;[a[c], a[best]] = [a[best], a[c]]
    if (Math.abs(a[c][c]) < 1e-12) throw new ScanError('Could not line the page up.')
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]
    }
  }
  return [...a.map((row, i) => row[n] / row[i]), 1]
}

/** Least-squares rotation + scale + shift (no perspective), page pts -> image px. */
function fitSimilarity(src: Pt[], dst: Pt[]) {
  const n = src.length
  const mean = (ps: Pt[]) => ({
    x: ps.reduce((s, p) => s + p.x, 0) / n,
    y: ps.reduce((s, p) => s + p.y, 0) / n,
  })
  const ms = mean(src)
  const md = mean(dst)
  let num1 = 0
  let num2 = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const px = src[i].x - ms.x
    const py = src[i].y - ms.y
    const qx = dst[i].x - md.x
    const qy = dst[i].y - md.y
    num1 += px * qx + py * qy
    num2 += px * qy - py * qx
    den += px * px + py * py
  }
  const a = num1 / den
  const b = num2 / den
  return {
    scale: Math.hypot(a, b),
    map: (p: Pt): Pt => ({
      x: a * (p.x - ms.x) - b * (p.y - ms.y) + md.x,
      y: b * (p.x - ms.x) + a * (p.y - ms.y) + md.y,
    }),
  }
}

/**
 * Looks for a solid dark square of roughly the expected size near `near`.
 * Returns its centre, or null.
 */
function findSquare(g: Gray, near: Pt, radius: number, side: number): Pt | null {
  const x0 = Math.max(0, Math.floor(near.x - radius))
  const y0 = Math.max(0, Math.floor(near.y - radius))
  const x1 = Math.min(g.width - 1, Math.ceil(near.x + radius))
  const y1 = Math.min(g.height - 1, Math.ceil(near.y + radius))
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w < 4 || h < 4) return null

  // Split ink from paper inside the window (Otsu).
  const hist = new Array<number>(256).fill(0)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) hist[g.data[y * g.width + x]]++
  const total = w * h
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]
  let wB = 0
  let sumB = 0
  let bestVar = -1
  let thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > bestVar) {
      bestVar = v
      thresh = t
    }
  }

  const seen = new Uint8Array(w * h)
  const expected = side * side
  let best: Pt | null = null
  let bestDist = Infinity
  const stack: number[] = []
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx
      if (seen[si] || g.data[(sy + y0) * g.width + sx + x0] > thresh) continue
      let area = 0
      let sX = 0
      let sY = 0
      let sXX = 0
      let sYY = 0
      let sXY = 0
      let touches = false
      stack.push(si)
      seen[si] = 1
      while (stack.length) {
        const i = stack.pop()!
        const cx = i % w
        const cy = (i - cx) / w
        area++
        sX += cx
        sY += cy
        sXX += cx * cx
        sYY += cy * cy
        sXY += cx * cy
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touches = true
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0)
          const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0)
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (seen[ni] || g.data[(ny + y0) * g.width + nx + x0] > thresh) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }
      if (touches || area < expected * 0.5 || area > expected * 2) continue
      const mx = sX / area
      const my = sY / area
      const vxx = sXX / area - mx * mx
      const vyy = sYY / area - my * my
      const vxy = sXY / area - mx * my
      const det = vxx * vyy - vxy * vxy
      if (det <= 0) continue
      // A solid square has area = 12 * sqrt(det of its covariance); hollow or thin shapes fall short.
      if (area / (12 * Math.sqrt(det)) < 0.85) continue
      const tr = vxx + vyy
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
      if ((tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc) > 2) continue
      const c = { x: mx + x0, y: my + y0 }
      const dist = Math.hypot(c.x - near.x, c.y - near.y)
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
  }
  return best
}

export interface PageRead {
  worksheetId: string
  page: number
  studentCode: string
  /** Reads the bubbles once the caller has looked the worksheet up. */
  read(size: PageSize, questions: Question[]): Record<string, Mark>
}

/** Finds the page code in a photo or scan. Throws ScanError when there isn't one. */
export function locatePage(img: Rgba): PageRead {
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
  const parsed = code && decodePageCode(code.data)
  if (!code || !parsed) throw new ScanError('No page code found. Make sure the whole page is in the picture.')
  const loc = code.location
  const qrImg = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]
  const modules = (code.version ?? 2) * 4 + 17
  const gray = toGray(img)
  return {
    ...parsed,
    read: (size, questions) => readPage(gray, size, questions, qrImg, modules),
  }
}

function readPage(g: Gray, size: PageSize, questions: Question[], qrImg: Pt[], modules: number) {
  const h = align(g, size, qrImg, modules)
  return readBubbles(g, h, questions)
}

function align(g: Gray, size: PageSize, qrImg: Pt[], modules: number): Homography {
  const qrPage = qrModuleCorners(size, modules)
  const sim = fitSimilarity(qrPage, qrImg)
  const side = FID_SIZE * sim.scale
  const [tl, tr, br, bl] = fiducials(size)
  const qc = { x: (qrPage[0].x + qrPage[2].x) / 2, y: (qrPage[0].y + qrPage[2].y) / 2 }
  const reach = (p: Pt) => Math.max(30, 0.2 * Math.hypot(p.x - qc.x, p.y - qc.y)) * sim.scale

  const fTR = findSquare(g, sim.map(tr), reach(tr), side)
  const fTL = findSquare(g, sim.map(tl), reach(tl), side)
  const fBR = findSquare(g, sim.map(br), reach(br), side)
  let fBL: Pt | null = null
  if (fTR && fTL && fBR) {
    // Three corners plus the page code pin down the perspective well enough to predict the fourth.
    const rough = solveHomography([tl, tr, br, ...qrPage], [fTL, fTR, fBR, ...qrImg])
    fBL = findSquare(g, applyH(rough, bl), 80 * sim.scale, side)
  }
  if (!fTR || !fTL || !fBR || !fBL) {
    throw new ScanError('Could not find all four corner squares. Retake the picture with every corner visible.')
  }
  const h = solveHomography([tl, tr, br, bl], [fTL, fTR, fBR, fBL])
  // The page code must land where we saw it, or the corners are wrong.
  for (let i = 0; i < 4; i++) {
    const p = applyH(h, qrPage[i])
    if (Math.hypot(p.x - qrImg[i].x, p.y - qrImg[i].y) > 6 * sim.scale) {
      throw new ScanError('Could not line the page up. Retake the picture with the page flat.')
    }
  }
  return h
}

function discMean(g: Gray, h: Homography, c: Pt, r: number): number {
  let sum = 0
  let n = 0
  const step = r / 5
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r * r) continue
      const p = applyH(h, { x: c.x + dx, y: c.y + dy })
      sum += sample(g, p.x, p.y)
      n++
    }
  }
  return sum / n
}

/** Brightness of the paper just outside a bubble. */
function paperLevel(g: Gray, h: Homography, c: Pt): number {
  const vals: number[] = []
  for (const r of [1.4, 1.6]) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2
      const p = applyH(h, { x: c.x + Math.cos(t) * r * BUBBLE_R, y: c.y + Math.sin(t) * r * BUBBLE_R })
      vals.push(sample(g, p.x, p.y))
    }
  }
  vals.sort((x, y) => x - y)
  return vals[Math.floor(vals.length * 0.8)]
}

export const FILLED = 0.25
export const BLANK = 0.1

function readBubbles(g: Gray, h: Homography, questions: Question[]): Record<string, Mark> {
  const raw = questions.map((q) =>
    Array.from({ length: q.choices }, (_, i) => {
      const c = bubbleCenter(q, i)
      const paper = paperLevel(g, h, c)
      const v = discMean(g, h, c, BUBBLE_R * 0.7)
      // Pure black would be near 0; compare against local paper so shadows don't matter.
      return Math.max(0, Math.min(1, (paper - v) / Math.max(40, paper - 20)))
    }),
  )
  // Most bubbles are empty, so a low percentile tells us what "empty" looks like on this page
  // (the printed letter inside adds a little darkness).
  const all = raw.flat().sort((x, y) => x - y)
  const base = all.length ? all[Math.floor(all.length * 0.25)] : 0

  const out: Record<string, Mark> = {}
  questions.forEach((q, qi) => {
    const scores = raw[qi].map((s) => Math.max(0, s - base))
    const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a])
    const top = scores[order[0]]
    const second = scores[order[1]] ?? 0
    let mark: Mark
    if (top < BLANK) mark = { choice: null, status: 'blank', scores }
    else if (top >= FILLED && second < Math.max(BLANK, 0.5 * top)) mark = { choice: order[0], status: 'ok', scores }
    else if (second >= FILLED && second >= 0.6 * top) mark = { choice: null, status: 'multi', scores }
    else mark = { choice: order[0], status: 'unsure', scores }
    mark.crop = cropQuestion(g, h, q)
    out[q.id] = mark
  })
  return out
}

function cropQuestion(g: Gray, h: Homography, q: Question) {
  const box = questionBox(q, 8)
  // Room for the printed question number.
  if (q.dir === 'h') {
    box.x -= 12
    box.width += 12
  } else {
    box.y -= 10
    box.height += 10
  }
  const ppp = 3 // pixels per point
  const width = Math.round(box.width * ppp)
  const height = Math.round(box.height * ppp)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyH(h, { x: box.x + (x + 0.5) / ppp, y: box.y + (y + 0.5) / ppp })
      data[y * width + x] = sample(g, p.x, p.y)
    }
  }
  return { width, height, data }
}
