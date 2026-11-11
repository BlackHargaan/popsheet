import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildRows, toCsv } from '../src/core/grade'
import {
  answerBubbles,
  gridBubble,
  gridColumns,
  gridProblem,
  gridQuestions,
  parseNumber,
  readGrid,
  sameNumber,
} from '../src/core/grids'
import { buildPrintable } from '../src/core/pdf'
import { makeSampleWorksheet } from '../src/core/sample'
import { locatePage } from '../src/core/scan'
import type { Rgba } from '../src/core/scan'
import type { Mark, NumberGrid, Worksheet } from '../src/core/types'
import { changedSincePrint, layoutForScan, versionForPrint } from '../src/core/versions'
import { photograph, rng } from './helpers'

const grid: NumberGrid = {
  id: 'GRD1',
  page: 0,
  x: 300,
  y: 450,
  label: '11',
  columns: 3,
  decimal: true,
  negative: true,
  answer: '-4.5',
  points: 2,
}

describe('numbers', () => {
  it('matches the same number however it is written', () => {
    expect(sameNumber('0.5', '.5')).toBe(true)
    expect(sameNumber('00.50', '0.5')).toBe(true)
    expect(sameNumber('−4.5', '-4.5')).toBe(true)
    expect(sameNumber('45', '4.5')).toBe(false)
    expect(sameNumber('5', null)).toBe(false)
    expect(parseNumber('4..5')).toBeNull()
    expect(parseNumber('.')).toBeNull()
  })

  it('says when the key cannot be bubbled in the grid', () => {
    const g = { columns: 3, decimal: false, negative: false }
    expect(gridProblem(g, '120')).toBeNull()
    expect(gridProblem(g, '1200')).toBe('Needs 4 columns')
    expect(gridProblem(g, '1.5')).toBe('Needs a decimal point')
    expect(gridProblem(g, '-3')).toBe('Needs a minus bubble')
    expect(gridProblem(g, 'ten')).toBe('Not a number')
    // ".25" fits in three columns even though "0.25" doesn't.
    expect(gridProblem({ ...g, decimal: true }, '0.25')).toBeNull()
  })

  it('lays the key out right-aligned', () => {
    const key = answerBubbles(grid, '-4.5')!
    const cols = gridColumns(grid)
    expect(cols.map((c) => key.get(c.id))).toEqual([0, 5, 0, 6]) // minus, 4, ., 5 (rows are . 0 1 2 …)
    const plain = { ...grid, columns: 4, negative: false }
    const cs = gridColumns(plain)
    expect(cs.map((c) => answerBubbles(plain, '27')!.get(c.id))).toEqual([undefined, undefined, 3, 8])
  })
})

describe('reading a grid from its column marks', () => {
  const mark = (choice: number | null, status: Mark['status'] = choice === null ? 'blank' : 'ok'): Mark => ({ choice, status, scores: [] })
  const cols = gridColumns(grid)
  const marksOf = (...m: Mark[]) => Object.fromEntries(cols.map((c, i) => [c.id, m[i]]))

  it('reads a number wherever it sits in the grid', () => {
    expect(readGrid(grid, marksOf(mark(null), mark(3), mark(8), mark(null)))).toEqual({ text: '27', status: 'ok', overridden: false })
    expect(readGrid(grid, marksOf(mark(null), mark(null), mark(null), mark(8)))?.text).toBe('7')
    expect(readGrid(grid, marksOf(mark(0), mark(5), mark(0), mark(6)))?.text).toBe('-4.5')
  })

  it('treats an untouched grid as blank and an unscanned one as missing', () => {
    expect(readGrid(grid, marksOf(mark(null), mark(null), mark(null), mark(null)))?.status).toBe('blank')
    expect(readGrid(grid, {})).toBeNull()
  })

  it('flags double marks, gaps, a lone minus and two decimal points', () => {
    expect(readGrid(grid, marksOf(mark(null), mark(null, 'multi'), mark(3), mark(4)))?.status).toBe('review')
    expect(readGrid(grid, marksOf(mark(null), mark(3), mark(null), mark(4)))?.status).toBe('review')
    expect(readGrid(grid, marksOf(mark(0), mark(null), mark(null), mark(null)))?.status).toBe('review')
    expect(readGrid(grid, marksOf(mark(null), mark(0), mark(5), mark(0)))?.status).toBe('review')
  })

  it("uses the teacher's correction over the bubbles", () => {
    const m = marksOf(mark(null), mark(null, 'multi'), mark(3), mark(4))
    expect(readGrid(grid, m, '23')).toEqual({ text: '23', status: 'ok', overridden: true })
    expect(readGrid(grid, m, null)).toEqual({ text: null, status: 'blank', overridden: true })
  })
})

describe('number grids on paper', () => {
  const DPI = 150
  const K = DPI / 72
  let ws: Worksheet
  let clean: PNG

  beforeAll(async () => {
    const base = await makeSampleWorksheet()
    ws = { ...base, grids: [grid] }
    ws = versionForPrint(ws).ws
    const pdf = await buildPrintable(ws, [{ code: 'AB2C', label: 'Test Student' }], 1)
    const dir = mkdtempSync(join(tmpdir(), 'popsheet-'))
    writeFileSync(join(dir, 'in.pdf'), pdf)
    execFileSync('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')])
    clean = PNG.sync.read(readFileSync(join(dir, 'out.png')))
  })

  /** Pencils in the given bubble (column index → row) of the grid. */
  function fill(rows: (number | null)[], level = 70): PNG {
    const img = new PNG({ width: clean.width, height: clean.height })
    clean.data.copy(img.data)
    const rand = rng(11)
    gridColumns(grid).forEach((col, i) => {
      const row = rows[i]
      if (row === null) return
      const c = gridBubble(grid, col, row)
      const r = 6 * K
      for (let y = Math.floor(c.y * K - r); y <= c.y * K + r; y++) {
        for (let x = Math.floor(c.x * K - r); x <= c.x * K + r; x++) {
          if ((x - c.x * K) ** 2 + (y - c.y * K) ** 2 > r * r) continue
          const j = (y * img.width + x) * 4
          img.data[j] = img.data[j + 1] = img.data[j + 2] = Math.min(img.data[j], level + rand() * 50)
        }
      }
    })
    return img
  }

  const asRgba = (img: PNG): Rgba => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height })

  function scan(img: Rgba) {
    const page = locatePage(img)
    const layout = layoutForScan(ws, page.version)!
    return page.read(ws.pages[0], layout.grids.flatMap(gridQuestions), false)
  }

  it('reads a negative decimal from a flat scan', () => {
    const marks = scan(asRgba(fill([0, 5, 0, 6])))
    expect(readGrid(grid, marks)).toEqual({ text: '-4.5', status: 'ok', overridden: false })
  })

  it('reads a short number from a tilted photo', () => {
    const img = photograph(fill([null, null, 3, 8]), 1500, 2000, [
      { x: 190, y: 160 },
      { x: 1330, y: 90 },
      { x: 1440, y: 1830 },
      { x: 90, y: 1900 },
    ], 0.4)
    expect(readGrid(grid, scan(img))).toEqual({ text: '27', status: 'ok', overridden: false })
  })

  it('reads an empty grid as blank', () => {
    expect(readGrid(grid, scan(asRgba(fill([null, null, null, null]))))?.status).toBe('blank')
  })

  it('scores it and puts it in the export', () => {
    const marks = scan(asRgba(fill([0, 5, 0, 6])))
    const rec = { worksheetId: ws.id, studentCode: 'AB2C', page: 0, scannedAt: 1, marks }
    const [row] = buildRows(ws, [rec], [])
    expect(row.numbers[grid.id].text).toBe('-4.5')
    expect(row.score).toBe(2)
    expect(toCsv(ws, [row])).toContain('Q11 (number)')
    // A teacher correction to a wrong number takes the points away.
    const [fixed] = buildRows(ws, [{ ...rec, numbers: { [grid.id]: '4.5' } }], [])
    expect(fixed.score).toBe(0)
  })

  it('makes a new printed version when a grid moves or changes shape', () => {
    expect(changedSincePrint(ws)).toBe(false)
    expect(changedSincePrint({ ...ws, grids: [{ ...grid, x: grid.x + 20 }] })).toBe(true)
    expect(changedSincePrint({ ...ws, grids: [{ ...grid, columns: 4 }] })).toBe(true)
    // The key and points aren't printed, so changing them keeps the version.
    expect(changedSincePrint({ ...ws, grids: [{ ...grid, answer: '7', points: 5 }] })).toBe(false)
  })
})
