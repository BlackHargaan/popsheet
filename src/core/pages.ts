import { PDFDocument } from 'pdf-lib'
import { duplicateWorksheet } from './editing'
import type { Worksheet } from './types'

/** Extract pages in their original order and remap all answer geometry to the new page indices. */
export async function keepWorksheetPages(ws: Worksheet, selected: number[], asCopy = false): Promise<Worksheet> {
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(page => !Number.isInteger(page) || page < 0 || page >= ws.pages.length)) {
    throw new Error('Choose at least one valid page to keep.')
  }
  if (!asCopy && (ws.printed?.length || ws.extras.length)) {
    throw new Error('Save selected pages as a new worksheet to preserve printed copies.')
  }
  const kept = [...selected].sort((a, b) => a - b)
  const source = await PDFDocument.load(ws.pdf)
  if (source.getPageCount() !== ws.pages.length) throw new Error('The PDF does not match this worksheet’s page list.')
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(source, kept)) out.addPage(page)
  out.setTitle(ws.name)
  const mapping = new Map(kept.map((old, index) => [old, index]))
  const remap = <T extends { page: number }>(items: T[]) => items.filter(item => mapping.has(item.page)).map(item => ({ ...item, page: mapping.get(item.page)! }))
  const next: Worksheet = {
    ...ws,
    pdf: await out.save(),
    pages: kept.map(page => ({ ...ws.pages[page] })),
    pageCodes: ws.pageCodes ? kept.map(page => ws.pageCodes?.[page] ?? null) : undefined,
    questions: remap(ws.questions),
    boxes: ws.boxes ? remap(ws.boxes) : undefined,
    grids: ws.grids ? remap(ws.grids) : undefined,
  }
  return asCopy ? { ...duplicateWorksheet(next), name: `${ws.name} (selected pages)` } : next
}
