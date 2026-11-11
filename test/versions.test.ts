import { describe, expect, it } from 'vitest'
import { buildRows, toCsv } from '../src/core/grade'
import { boxFromPage, boxOnPage, decodePageCode, encodePageCode } from '../src/core/layout'
import type { Question, ScanRecord, Worksheet } from '../src/core/types'
import { changedSincePrint, layoutForScan, versionForPrint } from '../src/core/versions'

const q = (id: string, x: number, answer: number | null = 0): Question => ({
  id,
  page: 0,
  x,
  y: 100,
  choices: 4,
  dir: 'h',
  answer,
  points: 1,
})

const base: Worksheet = {
  id: 'WS1234',
  name: 'Quiz',
  createdAt: 0,
  pdf: new Uint8Array(),
  pages: [{ width: 612, height: 792 }],
  scale: 0.9,
  questions: [q('Q1', 400), q('Q2', 420)],
  extras: [],
}

describe('page codes', () => {
  it('round-trips a versioned code', () => {
    expect(decodePageCode(encodePageCode('WS1234', 2, 7, 'AB2C'))).toEqual({
      worksheetId: 'WS1234',
      page: 2,
      version: 7,
      studentCode: 'AB2C',
    })
  })

  it('still reads codes printed before versions existed', () => {
    expect(decodePageCode('PS1:WS1234:0:AB2C')).toEqual({ worksheetId: 'WS1234', page: 0, version: null, studentCode: 'AB2C' })
  })

  it('rejects anything else', () => {
    expect(decodePageCode('PS2:WS1234:0:AB2C')).toBeNull()
    expect(decodePageCode('https://example.com')).toBeNull()
  })
})

describe('printed versions', () => {
  it('starts at version 1 and reuses it while nothing printed changes', () => {
    const first = versionForPrint(base, 1)
    expect(first.version).toBe(1)
    expect(first.ws.printed).toHaveLength(1)
    const again = versionForPrint(first.ws, 2)
    expect(again.version).toBe(1)
    expect(again.ws).toBe(first.ws)
  })

  it('does not make a new version for answer-key or points changes', () => {
    const { ws } = versionForPrint(base)
    const rekeyed = { ...ws, questions: ws.questions.map((x) => ({ ...x, answer: 3, points: 5 })) }
    expect(changedSincePrint(rekeyed)).toBe(false)
    expect(versionForPrint(rekeyed).version).toBe(1)
  })

  it('makes a new version when bubbles move, are added or the page shrink changes', () => {
    const { ws } = versionForPrint(base)
    const moved = { ...ws, questions: [q('Q1', 450), q('Q2', 420)] }
    expect(changedSincePrint(moved)).toBe(true)
    expect(versionForPrint(moved).version).toBe(2)
    expect(versionForPrint({ ...ws, questions: [...ws.questions, q('Q3', 300)] }).version).toBe(2)
    expect(versionForPrint({ ...ws, scale: 0.85 }).version).toBe(2)
  })

  it('reads old sheets with the layout they were printed with', () => {
    const v1 = versionForPrint(base).ws
    const v2 = versionForPrint({ ...v1, scale: 0.85, questions: [q('Q1', 450), q('Q2', 420)] }).ws
    expect(layoutForScan(v2, 1)!.questions.map((x) => x.x)).toEqual([400, 420])
    expect(layoutForScan(v2, 1)!.scale).toBe(0.9)
    expect(layoutForScan(v2, 2)!.questions.map((x) => x.x)).toEqual([450, 420])
    expect(layoutForScan(v2, 9)).toBeNull()
    // Unversioned (PS1) sheets fall back to the current layout.
    expect(layoutForScan(v2, null)!.questions).toBe(v2.questions)
  })
})

describe('answer boxes', () => {
  it('maps between original-page and printed-page points', () => {
    const size = { width: 612, height: 792 }
    const b = { x: 100, y: 200, width: 150, height: 40 }
    const onPage = boxOnPage(b, size, 0.9)
    expect(onPage.x).toBeCloseTo(30.6 + 90)
    expect(onPage.width).toBeCloseTo(135)
    const back = boxFromPage(onPage, size, 0.9)
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(b[k])
  })

  it('counts teacher scores toward the total and lists what is still ungraded', () => {
    const ws: Worksheet = {
      ...base,
      boxes: [
        { id: 'B1', page: 0, x: 0, y: 0, width: 50, height: 20, label: '3', points: 4 },
        { id: 'B2', page: 0, x: 0, y: 50, width: 50, height: 20, label: '4', points: 2 },
      ],
    }
    const scan = (code: string): ScanRecord => ({
      worksheetId: ws.id,
      studentCode: code,
      page: 0,
      scannedAt: 0,
      marks: { Q1: { choice: 0, status: 'ok', scores: [] }, Q2: { choice: 1, status: 'ok', scores: [] } },
    })
    const rows = buildRows(ws, [scan('AAAA'), scan('BBBB')], [], { AAAA: { B1: 3, B2: 2 }, BBBB: { B1: 9 } })
    const a = rows.find((r) => r.code === 'AAAA')!
    const b = rows.find((r) => r.code === 'BBBB')!
    expect(a.max).toBe(2 + 4 + 2)
    expect(a.score).toBe(1 + 3 + 2)
    expect(a.ungraded).toBe(0)
    // Scores never exceed a box's points, and an unscored box is counted as still to grade.
    expect(b.score).toBe(1 + 4)
    expect(b.ungraded).toBe(1)

    const csv = toCsv(ws, rows).split('\n')
    expect(csv[0]).toContain('Q3 (written),Q4 (written)')
    expect(csv[csv.length - 1]).toContain('out of 4,out of 2')
  })
})
