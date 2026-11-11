import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { bubbleCenter } from '../src/core/layout'
import { buildPrintable } from '../src/core/pdf'
import { makeSampleWorksheet } from '../src/core/sample'
import { locatePage } from '../src/core/scan'
import type { Rgba } from '../src/core/scan'
import type { Worksheet } from '../src/core/types'
import { layoutForScan, versionForPrint } from '../src/core/versions'
import { photograph, rng } from './helpers'

const DPI = 150
const K = DPI / 72
let ws: Worksheet
let clean: PNG

beforeAll(async () => {
  ws = await makeSampleWorksheet()
  const pdf = await buildPrintable(ws, [{ code: 'AB2C', label: 'Test Student' }], 1)
  const dir = mkdtempSync(join(tmpdir(), 'popsheet-'))
  writeFileSync(join(dir, 'in.pdf'), pdf)
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')])
  clean = PNG.sync.read(readFileSync(join(dir, 'out.png')))
})

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

function read(img: Rgba) {
  const page = locatePage(img)
  expect(page.worksheetId).toBe(ws.id)
  expect(page.studentCode).toBe('AB2C')
  expect(page.page).toBe(0)
  expect(page.version).toBe(1)
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

  it('reads a sheet against the layout it was printed with, after the bubbles moved', () => {
    const v1 = versionForPrint(ws).ws
    // The teacher nudges question 1 sideways after printing; old copies still have it in the old place.
    const v2 = versionForPrint({ ...v1, questions: v1.questions.map((q, i) => (i === 0 ? { ...q, x: q.x - 60 } : q)) }).ws
    const img = photograph(fillBubbles(allFilled), 1500, 2000, [
      { x: 150, y: 120 },
      { x: 1380, y: 100 },
      { x: 1420, y: 1880 },
      { x: 110, y: 1900 },
    ])
    const page = locatePage(img)
    const layout = layoutForScan(v2, page.version)!
    const marks = page.read(ws.pages[0], layout.questions)
    expect(ws.questions.map((q) => marks[q.id].choice)).toEqual(answers)
    // Reading with the edited layout instead would miss question 1.
    const wrong = page.read(ws.pages[0], v2.questions)
    expect(wrong[ws.questions[0].id].choice).not.toBe(answers[0])
  })

  it('straightens a tilted photo so written answers can be cropped by position', () => {
    // A dark scribble in a known spot of the printed page...
    const img = new PNG({ width: clean.width, height: clean.height })
    clean.data.copy(img.data)
    const spot = { x: 120, y: 560, width: 160, height: 30 }
    for (let y = Math.round(spot.y * K); y < (spot.y + spot.height) * K; y++) {
      for (let x = Math.round(spot.x * K); x < (spot.x + spot.width) * K; x++) {
        const i = (y * img.width + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 40
      }
    }
    const photo = photograph(img, 1500, 2000, [
      { x: 190, y: 160 },
      { x: 1330, y: 90 },
      { x: 1440, y: 1830 },
      { x: 90, y: 1900 },
    ], 0.3)
    const ppp = 2
    const flat = locatePage(photo).straighten(ws.pages[0], ppp)
    expect(flat.width).toBe(Math.round(ws.pages[0].width * ppp))
    const mean = (r: typeof spot) => {
      let sum = 0
      let n = 0
      for (let y = Math.round(r.y * ppp); y < (r.y + r.height) * ppp; y++) {
        for (let x = Math.round(r.x * ppp); x < (r.x + r.width) * ppp; x++) {
          sum += flat.data[y * flat.width + x]
          n++
        }
      }
      return sum / n
    }
    // ...comes out dark exactly where it was drawn (inset to allow for blur), and the paper beside it is light.
    expect(mean({ x: spot.x + 4, y: spot.y + 4, width: spot.width - 8, height: spot.height - 8 })).toBeLessThan(90)
    expect(mean({ x: spot.x, y: spot.y + spot.height + 12, width: spot.width, height: 12 })).toBeGreaterThan(150)
  })

  it('finds a page code that the decoder misses at full photo size', async () => {
    // With this worksheet id the code's pattern didn't decode in this photo at full size (each square is
    // about 4 pixels wide, plus camera noise). The scanner now looks again at smaller sizes.
    const hard = { ...ws, id: 'QA4L6E' }
    const pdf = await buildPrintable(hard, [{ code: 'AB2C', label: 'Test Student' }], 1)
    const dir = mkdtempSync(join(tmpdir(), 'popsheet-'))
    writeFileSync(join(dir, 'in.pdf'), pdf)
    execFileSync('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')])
    const photo = photograph(PNG.sync.read(readFileSync(join(dir, 'out.png'))), 1500, 2000, [
      { x: 150, y: 120 },
      { x: 1380, y: 100 },
      { x: 1420, y: 1880 },
      { x: 110, y: 1900 },
    ])
    const page = locatePage(photo)
    expect(page.worksheetId).toBe('QA4L6E')
    // The corners found on the smaller copy line the full-size page up correctly.
    expect(Object.values(page.read(hard.pages[0], hard.questions)).every((m) => m.status === 'blank')).toBe(true)
  })

  it('finds a page code whose squares are only a few pixels wide', async () => {
    // In this photo each square of the code is about 3 pixels wide, and the decoder misses it at full size and
    // smaller. The scanner then looks at an enlarged copy (and maps the corners back to this photo).
    const hard = { ...ws, id: 'QA4L6E' }
    const pdf = await buildPrintable(hard, [{ code: 'AB2C', label: 'Test Student' }], 1)
    const dir = mkdtempSync(join(tmpdir(), 'popsheet-'))
    writeFileSync(join(dir, 'in.pdf'), pdf)
    execFileSync('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')])
    const k = 1250 / 1200
    const photo = photograph(PNG.sync.read(readFileSync(join(dir, 'out.png'))), 1250, Math.round((1250 * 4) / 3), [
      { x: 120 * k, y: 90 * k },
      { x: 1100 * k, y: 80 * k },
      { x: 1140 * k, y: 1510 * k },
      { x: 90 * k, y: 1520 * k },
    ], 0.25)
    const page = locatePage(photo)
    expect(page.worksheetId).toBe('QA4L6E')
    expect(Object.values(page.read(hard.pages[0], hard.questions)).every((m) => m.status === 'blank')).toBe(true)
  })

  it('never silently misreads a faint tick', () => {
    // A tiny, faint mark must come back blank or flagged, not as a confident answer.
    const img = fillBubbles([{ q: 0, choice: 2, level: 170, cover: 0.45 }])
    const marks = read({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height })
    expect(marks[ws.questions[0].id].status).not.toBe('ok')
  })
})
