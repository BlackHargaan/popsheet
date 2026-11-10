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
}

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
}

export const LETTERS = 'ABCDEF'
