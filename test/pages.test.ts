import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { keepWorksheetPages } from '../src/core/pages'
import type { Worksheet } from '../src/core/types'

async function worksheet(): Promise<Worksheet> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 5; i++) doc.addPage([612 + i * 10, 792]).drawText(`Page ${i + 1}`, { x: 100, y: 600, font })
  return { id: 'WS1234', name: 'Five pages', createdAt: 1, pdf: await doc.save(), pages: doc.getPages().map(p => p.getSize()), scale: .9, extras: [],
    pageCodes: Array.from({ length: 5 }, (_, i) => ({ x: 450 + i, y: 20 })),
    questions: Array.from({ length: 5 }, (_, i) => ({ id: `Q${i}`, page: i, x: 100, y: 150, choices: 4, dir: 'h', answer: i % 4, points: 1 })),
    boxes: [{ id: 'B1', page: 2, x: 100, y: 300, width: 100, height: 30, label: '6', points: 2 }],
    grids: [{ id: 'G1', page: 4, x: 400, y: 300, label: '7', columns: 2, negative: false, decimal: true, answer: '2.5', points: 1 }],
  }
}

describe('keeping PDF pages', () => {
  it('keeps only a chosen page in the PDF and remaps its answer items and code', async () => {
    const original = await worksheet()
    const next = await keepWorksheetPages(original, [2])
    expect(next.id).toBe(original.id)
    expect((await PDFDocument.load(next.pdf)).getPageCount()).toBe(1)
    expect(next.pages).toEqual([{ width: 632, height: 792 }])
    expect(next.questions).toEqual([{ ...original.questions[2], page: 0 }])
    expect(next.boxes).toEqual([{ ...original.boxes![0], page: 0 }])
    expect(next.grids).toEqual([])
    expect(next.pageCodes).toEqual([original.pageCodes![2]])
    expect(original.pages).toHaveLength(5)
    expect((await PDFDocument.load(original.pdf)).getPageCount()).toBe(5)
  })
  it('preserves original order, page sizes and retained grid geometry', async () => {
    const original = await worksheet()
    const next = await keepWorksheetPages(original, [4, 1])
    const doc = await PDFDocument.load(next.pdf)
    expect(doc.getPages().map(p => p.getWidth())).toEqual([622, 652])
    expect(next.questions.map(q => [q.id, q.page])).toEqual([['Q1', 0], ['Q4', 1]])
    expect(next.grids![0]).toEqual({ ...original.grids![0], page: 1 })
  })
  it('rejects empty, duplicate, fractional and out-of-range selections', async () => {
    const ws = await worksheet()
    for (const indices of [[], [0, 0], [-1], [5], [.5]]) await expect(keepWorksheetPages(ws, indices)).rejects.toThrow(/Choose at least/)
  })
  it('protects printed worksheets and creates an independent selected-page copy', async () => {
    const ws = await worksheet()
    const original = { ...ws, extras: ['AB2C'], printed: [{ version: 1, printedAt: 1, scale: .9, questions: ws.questions }] }
    await expect(keepWorksheetPages(original, [2])).rejects.toThrow(/new worksheet/)
    const next = await keepWorksheetPages(original, [2], true)
    expect(next.id).not.toBe(original.id)
    expect(next.name).toBe('Five pages (selected pages)')
    expect(next.questions[0].id).not.toBe(original.questions[2].id)
    expect(next.questions[0].page).toBe(0)
    expect(next.printed).toBeUndefined()
    expect(next.extras).toEqual([])
    expect(original.printed).toHaveLength(1)
  })
})
