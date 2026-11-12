import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPrintable } from '../src/core/pdf'
import { describe, expect, it } from 'vitest'
import { duplicateItems, duplicateWorksheet } from '../src/core/editing'
import { codeCoversInk, layoutWarnings } from '../src/core/layoutWarnings'
import { buildRows } from '../src/core/grade'
import { reviewTargets } from '../src/core/review'
import type { Worksheet, ScanRecord } from '../src/core/types'

const base: Worksheet = { id: 'WS1234', name: 'Quiz', createdAt: 1, pdf: new Uint8Array([1]), pages: [{ width: 612, height: 792 }], scale: .9, extras: ['AB2C'], questions: [
  { id: 'Q1', page: 0, x: 100, y: 150, choices: 4, dir: 'h', answer: 1, points: 2 },
  { id: 'Q2', page: 0, x: 300, y: 300, choices: 4, dir: 'h', answer: 0, points: 1 },
] }

describe('duplication', () => {
  it('repeats a mixed selection with fresh IDs, labels and equal spacing', () => {
    const ws: Worksheet = { ...base, boxes: [{ id: 'B1', page: 0, x: 200, y: 130, width: 40, height: 40, label: '3', points: 2, expected: '42' }] }
    const { ws: copy, ids } = duplicateItems(ws, 0, ['Q1', 'B1'], 2)
    expect(copy.questions).toHaveLength(4)
    expect(copy.boxes).toHaveLength(3)
    expect(new Set([...copy.questions, ...copy.boxes!].map(i => i.id)).size).toBe(7)
    expect(copy.questions[2].answer).toBe(1)
    expect(copy.questions[2].points).toBe(2)
    expect(copy.boxes![1].expected).toBe('42')
    expect(copy.boxes![1].label).not.toBe('3')
    expect(copy.questions[3].y - copy.questions[2].y).toBeCloseTo(copy.questions[2].y - copy.questions[0].y)
    expect(ids).toHaveLength(2)
    expect(ws.questions).toHaveLength(2)
  })
  it('refuses copies that cannot fit, without changing the worksheet', () => {
    expect(() => duplicateItems(base, 0, ['Q1'], 20)).toThrow(/Not enough room/)
    expect(base.questions).toHaveLength(2)
    const copy = duplicateItems(base, 0, ['Q1'], 1, 'across').ws
    expect(copy.questions[2].x).toBeGreaterThan(100)
    expect(copy.questions[2].y).toBe(150)
  })
  it('copies number-grid options and assigns unique labels', () => {
    const ws: Worksheet = { ...base, grids: [{ id: 'G1', page: 0, x: 300, y: 150, label: '3', columns: 2, decimal: true, negative: true, answer: '-2.5', points: 3 }] }
    const { ws: copied } = duplicateItems(ws, 0, ['G1'])
    expect(copied.grids).toHaveLength(2)
    expect(copied.grids![1]).toMatchObject({ columns: 2, decimal: true, negative: true, answer: '-2.5', points: 3 })
    expect(copied.grids![1].id).not.toBe('G1')
    expect(copied.grids![1].label).not.toBe('3')
  })
  it('makes a reusable worksheet without student codes or printed versions', () => {
    const copy = duplicateWorksheet({ ...base, printed: [{ version: 1, printedAt: 1, scale: .9, questions: base.questions }] })
    expect(copy.id).not.toBe(base.id)
    expect(copy.questions[0].id).not.toBe(base.questions[0].id)
    expect(copy.name).toBe('Quiz (copy)')
    expect(copy.extras).toEqual([])
    expect(copy.printed).toBeUndefined()
    expect(copy.pdf).toEqual(base.pdf)
  })
})

describe('layout checks', () => {
  it('accepts a clear layout and flags overlapping bubbles', () => {
    expect(layoutWarnings(base)).toEqual([])
    const ws = { ...base, questions: base.questions.map(q => ({ ...q, x: 100, y: 150 })) }
    expect(layoutWarnings(ws).some(w => w.message.includes('Question 1 overlaps question 2'))).toBe(true)
  })
  it('flags page code collisions, corner marks and page edges', () => {
    const ws = { ...base, pageCodes: [{ x: 90, y: 140 }] }
    expect(layoutWarnings(ws).some(w => w.ids.includes('page-code') && w.ids.includes('Q1'))).toBe(true)
    const corner = { ...base, pageCodes: [{ x: 10, y: 10 }] }
    expect(layoutWarnings(corner).some(w => w.message.includes('corner alignment'))).toBe(true)
    expect(layoutWarnings(corner).some(w => w.message.includes('page edge'))).toBe(true)
  })
  it('checks written answer spaces and keeps different pages separate', () => {
    const ws = { ...base, pages: [...base.pages, ...base.pages], pageCodes: [{ x: 100, y: 200 }], boxes: [{ id: 'B1', page: 0, x: 90, y: 180, width: 100, height: 100, label: '3', points: 1 }] }
    expect(layoutWarnings(ws).some(w => w.message.includes('covers written answer 3'))).toBe(true)
    const separate = { ...base, pages: [...base.pages, ...base.pages], questions: base.questions.map((q, i) => ({ ...q, page: i, x: 100, y: 150 })) }
    expect(layoutWarnings(separate)).toEqual([])
  })
  it('detects ink beneath a moved code using scaled original-page coordinates', () => {
    const ws = { ...base, pageCodes: [{ x: 100, y: 200 }] }
    const image = { width: 612, height: 792, data: new Uint8ClampedArray(612 * 792 * 4).fill(255) }
    expect(codeCoversInk(ws, 0, image)).toBe(false)
    for (let y = 180; y < 190; y++) for (let x = 90; x < 100; x++) {
      const i = (y * 612 + x) * 4
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 0
    }
    expect(codeCoversInk(ws, 0, image)).toBe(true)
    expect(codeCoversInk({ ...ws, pageCodes: [{ x: 450, y: 650 }] }, 0, image)).toBe(false)
  })
})

describe('review queue', () => {
  const ws: Worksheet = { ...base, questions: [...base.questions, { ...base.questions[0], id: 'Q3', y: 400 }], grids: [{ id: 'G1', page: 0, x: 400, y: 300, label: '4', columns: 1, decimal: false, negative: false, answer: '1', points: 1 }] }
  const rec: ScanRecord = { worksheetId: ws.id, studentCode: 'AB2C', page: 0, scannedAt: 1, marks: {
    Q1: { choice: 1, status: 'unsure', scores: [0, .3, .1, 0] },
    Q2: { choice: null, status: 'multi', scores: [.5, .5, 0, 0] },
    Q3: { choice: null, status: 'blank', scores: [0, 0, 0, 0] },
    'G1.0': { choice: null, status: 'blank', scores: Array(10).fill(0) },
  } }
  it('includes uncertain, multiple and blank answers with filter counts', () => {
    const rows = buildRows(ws, [rec], [])
    expect(reviewTargets(ws, rows).map(t => t.reason)).toEqual(['unsure', 'multi', 'blank', 'blank'])
    expect(reviewTargets(ws, rows, 'blank')).toHaveLength(2)
    expect(reviewTargets(ws, rows, 'multi')[0].qid).toBe('Q2')
  })
  it('excludes teacher-confirmed blanks and answers, but does not invent missing scans', () => {
    const corrected = { ...rec, marks: { ...rec.marks, Q1: { ...rec.marks.Q1, override: 1 }, Q3: { ...rec.marks.Q3, override: null } }, numbers: { G1: null } }
    expect(reviewTargets(ws, buildRows(ws, [corrected], [])).map(t => t.qid)).toEqual(['Q2'])
    expect(reviewTargets(ws, buildRows(ws, [], []))).toEqual([])
  })
})


describe('PDF previews with blank source pages', () => {
  it('keeps blank pages and prints every page for each copy', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    source.addPage([612, 792]).drawText('Question', { x: 100, y: 600, font })
    source.addPage([612, 792])
    const ws = { ...base, pdf: await source.save(), pages: [...base.pages, ...base.pages] }
    const output = await PDFDocument.load(await buildPrintable(ws, [{ code: 'AB2C', label: 'One' }, { code: 'CD3E', label: 'Two' }], 1))
    expect(output.getPageCount()).toBe(4)
    expect(output.getPages().every(page => page.node.Contents() !== undefined)).toBe(true)
  })
})
