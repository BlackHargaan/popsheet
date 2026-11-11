import { BUBBLE_R, BUBBLE_SPACING } from './layout'
import type { GridGeometry, Mark, NumberGrid, Question } from './types'

/**
 * Number grids: a student writes a number in a row of boxes, then fills one bubble per column underneath
 * (like the grid-in answers on standardised tests). The bubbles are what gets read; the written number is
 * there for the student, and for the teacher when a column needs a look.
 *
 * Each column is read like a vertical multiple-choice question, so the scanner needs nothing new. Columns
 * the student leaves empty are fine: a number can sit anywhere in the grid.
 */

export const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
export const MINUS = '−'
/** Height of the row of boxes the number is written in. */
export const GRID_WRITE_H = 16
/** Room above the write-in row for the question label. */
export const GRID_LABEL_H = 11

export interface GridColumn {
  /** Id of the column's reading in a scan's marks. */
  id: string
  x: number
  symbols: string[]
  sign: boolean
}

export const signId = (gridId: string) => `${gridId}.s`
export const columnId = (gridId: string, c: number) => `${gridId}.${c}`

/** The columns left to right: the sign column (when negatives are allowed), then the digit columns. */
export function gridColumns(g: GridGeometry): GridColumn[] {
  const cols: GridColumn[] = []
  if (g.negative) cols.push({ id: signId(g.id), x: g.x, symbols: [MINUS], sign: true })
  const digits = g.decimal ? ['.', ...DIGITS] : DIGITS
  for (let c = 0; c < g.columns; c++) {
    cols.push({ id: columnId(g.id, c), x: g.x + cols.length * BUBBLE_SPACING, symbols: digits, sign: false })
  }
  return cols
}

export const gridRows = (g: Pick<GridGeometry, 'decimal'>) => (g.decimal ? 11 : 10)

/** Centre of one bubble. */
export const gridBubble = (g: GridGeometry, col: GridColumn, row: number) => ({ x: col.x, y: g.y + row * BUBBLE_SPACING })

/** The columns as vertical questions, for the scanner. */
export function gridQuestions(g: GridGeometry): Question[] {
  return gridColumns(g).map((c) => ({
    id: c.id,
    page: g.page,
    x: c.x,
    y: g.y,
    choices: c.symbols.length,
    dir: 'v',
    answer: null,
    points: 0,
  }))
}

/** The write-in box above each column. */
export function writeBoxes(g: GridGeometry) {
  const w = BUBBLE_SPACING - 3
  const y = g.y - BUBBLE_R - 4 - GRID_WRITE_H
  return gridColumns(g).map((c) => ({ x: c.x - w / 2, y, width: w, height: GRID_WRITE_H }))
}

/** Everything the grid prints (label, write-in row, bubbles), with padding. */
export function gridBox(g: GridGeometry, pad = 4) {
  const cols = gridColumns(g)
  const last = cols[cols.length - 1]
  const top = g.y - BUBBLE_R - 4 - GRID_WRITE_H - GRID_LABEL_H
  const bottom = g.y + (gridRows(g) - 1) * BUBBLE_SPACING + BUBBLE_R
  const left = g.x - BUBBLE_R
  const right = last.x + BUBBLE_R
  return { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad }
}

export const geometryOfGrid = ({ id, page, x, y, columns, decimal, negative }: GridGeometry): GridGeometry => ({
  id,
  page,
  x,
  y,
  columns,
  decimal,
  negative,
})

// ---------- Numbers ----------

/** The value of a number written as text, or null if it isn't a plain number. */
export function parseNumber(text: string): number | null {
  const s = text.trim().replace(/[−–—]/g, '-').replace(/,/g, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  return Number(s)
}

/** True when two answers are the same number (so "0.5", ".5" and "00.50" all match). */
export function sameNumber(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const x = parseNumber(a)
  const y = parseNumber(b)
  return x !== null && y !== null && Math.abs(x - y) < 1e-9
}

/**
 * Why a number can't be bubbled in this grid, or null if it can. Used to warn the teacher when the answer
 * key needs a sign, a decimal point or more columns than the grid has.
 */
export function gridProblem(g: Pick<NumberGrid, 'columns' | 'decimal' | 'negative'>, text: string): string | null {
  const f = gridForm(g, text)
  return typeof f === 'string' ? f : null
}

/** How a number is bubbled in a grid (digits right-aligned), or why it can't be. */
function gridForm(g: Pick<NumberGrid, 'columns' | 'decimal' | 'negative'>, text: string) {
  const n = parseNumber(text)
  if (n === null) return 'Not a number'
  if (n < 0 && !g.negative) return 'Needs a minus bubble'
  let s = String(Math.abs(n))
  if (s.includes('e')) return 'Too long for the grid'
  if (s.includes('.') && !g.decimal) return 'Needs a decimal point'
  if (s.length > g.columns && s.startsWith('0.')) s = s.slice(1)
  if (s.length > g.columns) return `Needs ${s.length} columns`
  return { negative: n < 0, digits: s }
}

/** The bubble filled in each column for this answer (column id → row), or null if it doesn't fit. */
export function answerBubbles(g: GridGeometry, text: string): Map<string, number> | null {
  const f = gridForm(g, text)
  if (typeof f === 'string') return null
  const out = new Map<string, number>()
  if (f.negative) out.set(signId(g.id), 0)
  const digitCols = gridColumns(g).filter((c) => !c.sign)
  const start = digitCols.length - f.digits.length
  ;[...f.digits].forEach((ch, i) => {
    const col = digitCols[start + i]
    out.set(col.id, col.symbols.indexOf(ch))
  })
  return out
}

// ---------- Reading a filled-in grid ----------

export interface GridRead {
  /** The number as bubbled (a best guess when status is 'review'), or null if nothing was filled in. */
  text: string | null
  status: 'ok' | 'blank' | 'review'
  /** Set when the teacher typed the answer in. */
  overridden: boolean
}

/** A column needs a look when two bubbles are filled or one is faint; an empty column is normal. */
const columnUnclear = (m: Mark | undefined) => !!m && m.override === undefined && (m.status === 'multi' || m.status === 'unsure')

/**
 * What a student answered in a grid, from the scan's marks. Returns null when the page wasn't scanned.
 * `override` is the teacher's correction, if any.
 */
export function readGrid(g: GridGeometry, marks: Record<string, Mark>, override?: string | null): GridRead | null {
  if (override !== undefined) return { text: override, status: override === null ? 'blank' : 'ok', overridden: true }
  const cols = gridColumns(g)
  if (!cols.some((c) => marks[c.id])) return null
  let review = false
  let sign = ''
  const chars: string[] = []
  for (const c of cols) {
    const m = marks[c.id]
    if (columnUnclear(m)) review = true
    const choice = !m ? null : m.override !== undefined ? m.override : m.choice
    const ch = choice === null ? '' : c.symbols[choice]
    if (c.sign) sign = ch ? '-' : ''
    else chars.push(ch)
  }
  const first = chars.findIndex((ch) => ch !== '')
  const last = chars.length - 1 - [...chars].reverse().findIndex((ch) => ch !== '')
  if (first < 0) {
    // A minus sign and nothing else is a mistake worth a look; an untouched grid is just blank.
    return sign ? { text: '-', status: 'review', overridden: false } : { text: null, status: review ? 'review' : 'blank', overridden: false }
  }
  const body = chars.slice(first, last + 1)
  // A gap in the middle of the number, or two decimal points, means something was misread or misfilled.
  if (body.includes('') || body.filter((ch) => ch === '.').length > 1 || body.join('') === '.') review = true
  return { text: sign + body.join(''), status: review ? 'review' : 'ok', overridden: false }
}
