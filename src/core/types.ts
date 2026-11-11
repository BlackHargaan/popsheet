/** All page coordinates are PDF points (1/72 in) with the origin at the TOP-LEFT of the page. */

export interface Question {
  id: string
  page: number // 0-based
  /** Centre of the first bubble. */
  x: number
  y: number
  choices: number // 2..6
  dir: 'h' | 'v'
  /** Index of the correct choice, or null if not set yet. */
  answer: number | null
  points: number
}

export interface PageSize {
  width: number
  height: number
}

/**
 * An area where students write an answer (short answer, show your work). Not printed: the teacher draws it
 * around an answer space that is already on the worksheet, so it is stored in the ORIGINAL page's points
 * (before the page is shrunk by `scale`), top-left origin.
 */
export interface AnswerBox {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  /** Shown in the results and the grading screen, e.g. "11" or "11b". */
  label: string
  points: number
  /**
   * What a full-marks answer says, if the teacher has set it. Several accepted answers are separated by
   * semicolons ("x = 42; 42"). Answers that read the same are suggested for full marks.
   */
  expected?: string
}

/**
 * A number answer: a row of boxes the student writes the number in, over one column of bubbles per digit
 * (0–9, plus a decimal point when allowed). An optional sign column on the left holds a single minus bubble.
 * Placed on the printed page like bubbles, so it uses printed-page points.
 */
export interface NumberGrid {
  id: string
  page: number
  /** Centre of the top bubble in the first digit column. */
  x: number
  y: number
  label: string
  /** Number of digit columns, 1–6. */
  columns: number
  decimal: boolean
  negative: boolean
  /** The correct number as text (e.g. "42", "-3.5"), or null if not set yet. */
  answer: string | null
  points: number
}

export type GridGeometry = Pick<NumberGrid, 'id' | 'page' | 'x' | 'y' | 'columns' | 'decimal' | 'negative'>

/** The printed geometry of one version of a worksheet. Sheets carry this version in their page code. */
export interface PrintedLayout {
  version: number
  printedAt: number
  scale: number
  questions: Pick<Question, 'id' | 'page' | 'x' | 'y' | 'choices' | 'dir'>[]
  /** Missing on layouts printed before number grids existed. */
  grids?: GridGeometry[]
}

export interface Worksheet {
  /** Short uppercase id, printed inside the page code. */
  id: string
  name: string
  createdAt: number
  /** Original worksheet PDF. */
  pdf: Uint8Array
  pages: PageSize[]
  /** How much the original page is shrunk to leave room for the marks (1 = not at all). */
  scale: number
  questions: Question[]
  /** Codes of spare copies that are not tied to a student. */
  extras: string[]
  /** Written-answer areas, graded by hand question by question. Missing on older worksheets. */
  boxes?: AnswerBox[]
  /** Number answers, read from their bubbles. Missing on older worksheets. */
  grids?: NumberGrid[]
  /** Every layout that has been printed, oldest first. Missing on worksheets never printed. */
  printed?: PrintedLayout[]
}

/** A teacher's score for each student's written answers: studentCode -> boxId -> points. */
export type BoxGrades = Record<string, Record<string, number>>

/** What a student wrote in one answer box, as read on this device (or typed in by the teacher). */
export interface Reading {
  text: string
  /** False once the teacher has corrected it. */
  auto: boolean
  /** The scan and box it was read from; a rescan or a moved box means it must be read again. */
  scannedAt: number
  box: string
}
/** Student code → box id → reading. */
export type Readings = Record<string, Record<string, Reading>>

export interface Student {
  code: string
  name: string
}

export interface ClassRoom {
  id: string
  name: string
  students: Student[]
}

export type MarkStatus = 'ok' | 'blank' | 'multi' | 'unsure'

export interface Mark {
  /** What the scanner read (null = nothing / more than one). */
  choice: number | null
  status: MarkStatus
  scores: number[]
  /** Set when the teacher has corrected the reading by hand (null = teacher says blank). */
  override?: number | null
  /** Small greyscale crop of the bubble row, for review. */
  crop?: { width: number; height: number; data: Uint8Array }
}

export interface ScanRecord {
  worksheetId: string
  studentCode: string
  page: number
  scannedAt: number
  marks: Record<string, Mark>
  /** Printed layout version the sheet carried (missing for unversioned sheets). */
  version?: number
  /** The page straightened to page coordinates, `ppp` pixels per point, for cropping answer boxes. */
  image?: Blob
  ppp?: number
  /** Teacher corrections to number answers, by grid id (null = teacher says no answer). */
  numbers?: Record<string, string | null>
}

export const LETTERS = 'ABCDEF'
