import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { bubbleCenter } from '../src/core/layout'
import type { Pt } from '../src/core/layout'
import { buildPrintable } from '../src/core/pdf'
import { makeSampleWorksheet } from '../src/core/sample'
import { applyH, locatePage, solveHomography } from '../src/core/scan'
import type { Rgba } from '../src/core/scan'
import type { Worksheet } from '../src/core/types'

const DPI = 150
const K = DPI / 72
let ws: Worksheet
let clean: PNG

beforeAll(async () => {
  ws = await makeSampleWorksheet()
  const pdf = await buildPrintable(ws, [{ code: 'AB2C', label: 'Test Student' }])
  const dir = mkdtempSync(join(tmpdir(), 'popsheet-'))
  writeFileSync(join(dir, 'in.pdf'), pdf)
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')])
  clean = PNG.sync.read(readFileSync(join(dir, 'out.png')))
})

/** seeded noise */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface Fill {
  q: number
  choice: number
  /** pencil grey level, 0 = black */
  level?: number
  /** fraction of the bubble radius covered */
  cover?: number
}

function fillBubbles(fills: Fill[]): PNG {
  const img = new PNG({ width: clean.width, height: clean.height })
  clean.data.copy(img.data)
  const rand = rng(7)
  for (const f of fills) {
    const c = bubbleCenter(ws.questions[f.q], f.choice)
    const r = 6 * (f.cover ?? 1) * K
    const cx = c.x * K
    const cy = c.y * K
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
        const i = (y * img.width + x) * 4
        const v = Math.min(img.data[i], (f.level ?? 70) + rand() * 50)
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      }
    }
  }
  return img
}

/** Simulates a phone photo: page corners land on `quad` (TL, TR, BR, BL) in a w x h picture. */
function photograph(src: PNG, w: number, h: number, quad: Pt[], shade = 0): Rgba {
  const corners = [
    { x: 0, y: 0 },
    { x: src.width, y: 0 },
    { x: src.width, y: src.height },
    { x: 0, y: src.height },
  ]
  const inv = solveHomography(quad, corners)
  const out = new Uint8ClampedArray(w * h * 4)
  const rand = rng(3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = applyH(inv, { x, y })
      let v = [70, 52, 40] // desk
      if (p.x >= 0 && p.y >= 0 && p.x < src.width - 1 && p.y < src.height - 1) {
        const x0 = Math.floor(p.x)
        const y0 = Math.floor(p.y)
        const fx = p.x - x0
        const fy = p.y - y0
        v = [0, 1, 2].map((ch) => {
          const at = (xx: number, yy: number) => src.data[(yy * src.width + xx) * 4 + ch]
          return (
            at(x0, y0) * (1 - fx) * (1 - fy) +
            at(x0 + 1, y0) * fx * (1 - fy) +
            at(x0, y0 + 1) * (1 - fx) * fy +
            at(x0 + 1, y0 + 1) * fx * fy
          )
        })
      }
      const light = 1 - shade * ((x / w) * 0.6 + (y / h) * 0.4)
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) out[i + ch] = v[ch] * light * 0.93 + (rand() - 0.5) * 12
      out[i + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

function read(img: Rgba) {
  const page = locatePage(img)
  expect(page.worksheetId).toBe(ws.id)
  expect(page.studentCode).toBe('AB2C')
  expect(page.page).toBe(0)
  return page.read(ws.pages[0], ws.questions)
}

const answers = [1, 2, 0, 3, 1, 0, 2, 3, 2, 0]
const allFilled: Fill[] = answers.map((choice, q) => ({ q, choice }))

function expectAll(marks: ReturnType<typeof read>, expected: (number | null)[]) {
  const got = ws.questions.map((q) => marks[q.id].choice)
  expect(got).toEqual(expected)
}

describe('scanner', () => {
  it('reads a flat scan', () => {
    const img = fillBubbles(allFilled)
    const marks = read({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height })
    expectAll(marks, answers)
    for (const q of ws.questions) expect(marks[q.id].status).toBe('ok')
  })

  it('reads a tilted phone photo with a shadow', () => {
    const img = photograph(
      fillBubbles(allFilled),
      1500,
      2000,
      [
        { x: 190, y: 160 },
        { x: 1330, y: 90 },
        { x: 1440, y: 1830 },
        { x: 90, y: 1900 },
      ],
      0.45,
    )
    const marks = read(img)
    expectAll(marks, answers)
    for (const q of ws.questions) expect(marks[q.id].status).toBe('ok')
  })

  it('reads an upside-down page', () => {
    const img = photograph(fillBubbles(allFilled), 1400, 1800, [
      { x: 1340, y: 1740 },
      { x: 60, y: 1750 },
      { x: 50, y: 60 },
      { x: 1350, y: 50 },
    ])
    expectAll(read(img), answers)
  })

  it('reads a sideways, low-resolution photo', () => {
    const img = photograph(fillBubbles(allFilled), 1300, 1000, [
      { x: 1240, y: 60 },
      { x: 1250, y: 950 },
      { x: 60, y: 940 },
      { x: 70, y: 50 },
    ])
    expectAll(read(img), answers)
  })

  it('handles light pencil, erasures, blanks and double marks', () => {
    const fills: Fill[] = [
      { q: 0, choice: 1, level: 140 }, // light pencil
      { q: 1, choice: 2 },
      { q: 1, choice: 0, level: 215 }, // erased first try
      { q: 2, choice: 0 },
      { q: 2, choice: 3 }, // two answers
      // q3 left blank
      { q: 4, choice: 1, cover: 0.75 }, // not filled to the edge
      ...allFilled.slice(5),
    ]
    const img = photograph(fillBubbles(fills), 1500, 2000, [
      { x: 120, y: 100 },
      { x: 1400, y: 130 },
      { x: 1380, y: 1900 },
      { x: 100, y: 1870 },
    ], 0.3)
    const marks = read(img)
    const m = ws.questions.map((q) => marks[q.id])
    expect([m[0].choice, m[0].status]).toEqual([1, 'ok'])
    expect([m[1].choice, m[1].status]).toEqual([2, 'ok'])
    expect([m[2].choice, m[2].status]).toEqual([null, 'multi'])
    expect([m[3].choice, m[3].status]).toEqual([null, 'blank'])
    expect([m[4].choice, m[4].status]).toEqual([1, 'ok'])
    expect(m.slice(5).map((x) => x.choice)).toEqual(answers.slice(5))
  })

  it('never silently misreads a faint tick', () => {
    // A tiny, faint mark must come back blank or flagged, not as a confident answer.
    const img = fillBubbles([{ q: 0, choice: 2, level: 170, cover: 0.45 }])
    const marks = read({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height })
    expect(marks[ws.questions[0].id].status).not.toBe('ok')
  })
})
