import { qrBox } from './layout'
import { geometryOfGrid } from './grids'
import type { GridGeometry, PrintedLayout, Question, Worksheet } from './types'

/**
 * Printed layout versions.
 *
 * The bubbles and the page shrink are printed onto every sheet, so once copies are out in the world their
 * geometry is fixed. If the teacher later moves a bubble, the old sheets must still be read where their
 * bubbles really are. Every print records the layout it used, and the page code carries that version.
 * The answer key and points are NOT part of a layout: they are never printed, so changing them simply
 * re-scores every sheet.
 */

type Geometry = Pick<PrintedLayout, 'scale' | 'questions' | 'grids' | 'pageCodes'>

function geometryOf(ws: Worksheet): Geometry {
  return {
    scale: ws.scale,
    pageCodes: ws.pages.map((size, i) => ({ ...qrBox(size, ws.pageCodes?.[i]) })),
    questions: ws.questions.map(({ id, page, x, y, choices, dir }) => ({ id, page, x, y, choices, dir })),
    grids: (ws.grids ?? []).map(geometryOfGrid),
  }
}

const round = (v: number) => Math.round(v * 100) / 100

function sameGrids(a: GridGeometry[], b: GridGeometry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((g, i) => {
    const o = b[i]
    return (
      g.id === o.id &&
      g.page === o.page &&
      g.columns === o.columns &&
      g.decimal === o.decimal &&
      g.negative === o.negative &&
      round(g.x) === round(o.x) &&
      round(g.y) === round(o.y)
    )
  })
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
  if (a.scale !== b.scale || a.questions.length !== b.questions.length) return false
  const codes = a.pageCodes ?? []
  const other = b.pageCodes ?? []
  if (codes.length !== other.length) return false
  if (codes.some((p, i) => p?.x !== other[i]?.x || p?.y !== other[i]?.y)) return false
  if (!sameGrids(a.grids ?? [], b.grids ?? [])) return false
  return a.questions.every((q, i) => {
    const o = b.questions[i]
    return (
      q.id === o.id &&
      q.page === o.page &&
      q.choices === o.choices &&
      q.dir === o.dir &&
      round(q.x) === round(o.x) &&
      round(q.y) === round(o.y)
    )
  })
}

export function latestPrinted(ws: Worksheet): PrintedLayout | undefined {
  return ws.printed?.[ws.printed.length - 1]
}

/** True when bubbles or the page size changed after the last print, so new copies would be a new version. */
export function changedSincePrint(ws: Worksheet): boolean {
  const last = latestPrinted(ws)
  return !!last && !sameGeometry(geometryOf(ws), { ...last, pageCodes: ws.pages.map((size, i) => qrBox(size, last.pageCodes?.[i])) })
}

/**
 * The version to print the worksheet as right now. Reuses the latest version if nothing changed;
 * otherwise records a new one. Returns the worksheet to save (unchanged if no new version was needed).
 */
export function versionForPrint(ws: Worksheet, now = Date.now()): { ws: Worksheet; version: number } {
  const last = latestPrinted(ws)
  const geo = geometryOf(ws)
  if (last && sameGeometry(geo, { ...last, pageCodes: ws.pages.map((size, i) => qrBox(size, last.pageCodes?.[i])) })) return { ws, version: last.version }
  const layout: PrintedLayout = { version: (last?.version ?? 0) + 1, printedAt: now, ...geo }
  return { ws: { ...ws, printed: [...(ws.printed ?? []), layout] }, version: layout.version }
}

/** What a scanned sheet should be read against: its printed bubbles, number grids and page shrink. */
export function layoutForScan(
  ws: Worksheet,
  version: number | null,
): { scale: number; questions: Question[]; grids: GridGeometry[]; pageCodes?: Worksheet['pageCodes'] } | null {
  // Sheets printed before versions existed: the current layout is the best guess.
  if (version === null) return { scale: ws.scale, questions: ws.questions, grids: ws.grids ?? [], pageCodes: ws.pageCodes }
  const layout = ws.printed?.find((l) => l.version === version)
  if (!layout) return null
  // The scanner only needs geometry; answers and points come from the current key when grading.
  return {
    scale: layout.scale,
    pageCodes: layout.pageCodes,
    questions: layout.questions.map((q) => ({ ...q, answer: null, points: 0 })),
    grids: layout.grids ?? [],
  }
}

/** The page shrink a scanned sheet was printed with. */
export function scaleForScan(ws: Worksheet, version: number | undefined): number {
  if (version === undefined) return ws.scale
  return ws.printed?.find((l) => l.version === version)?.scale ?? ws.scale
}
