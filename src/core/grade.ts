import { LETTERS } from './types'
import type { ClassRoom, Mark, ScanRecord, Worksheet } from './types'

/** The answer that counts: the teacher's correction if there is one, else the scanner's reading. */
export function finalChoice(m: Mark | undefined): number | null {
  if (!m) return null
  return m.override !== undefined ? m.override : m.choice
}

export function needsReview(m: Mark | undefined): boolean {
  return !!m && m.override === undefined && m.status !== 'ok'
}

export interface StudentRow {
  code: string
  name: string
  marks: Record<string, Mark>
  pagesScanned: number[]
  score: number
  max: number
  flagged: number
}

export function buildRows(ws: Worksheet, scans: ScanRecord[], classes: ClassRoom[]): StudentRow[] {
  const names = new Map<string, string>()
  for (const c of classes) for (const s of c.students) names.set(s.code, s.name)
  const byStudent = new Map<string, ScanRecord[]>()
  for (const s of scans) {
    if (!byStudent.has(s.studentCode)) byStudent.set(s.studentCode, [])
    byStudent.get(s.studentCode)!.push(s)
  }
  const max = ws.questions.reduce((s, q) => s + (q.answer === null ? 0 : q.points), 0)
  const rows: StudentRow[] = []
  for (const [code, recs] of byStudent) {
    const marks: Record<string, Mark> = {}
    for (const r of recs) Object.assign(marks, r.marks)
    let score = 0
    let flagged = 0
    for (const q of ws.questions) {
      const m = marks[q.id]
      if (needsReview(m)) flagged++
      if (q.answer !== null && finalChoice(m) === q.answer) score += q.points
    }
    rows.push({
      code,
      name: names.get(code) ?? (ws.extras.includes(code) ? `Spare copy ${code}` : `Unknown ${code}`),
      marks,
      pagesScanned: recs.map((r) => r.page).sort(),
      score,
      max,
      flagged,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ItemStat {
  answered: number
  correct: number
  /** Most common wrong choice and how many students picked it. */
  topWrong: { choice: number; count: number } | null
}

export function itemStats(ws: Worksheet, rows: StudentRow[]): ItemStat[] {
  return ws.questions.map((q) => {
    let correct = 0
    const wrong = new Map<number, number>()
    for (const r of rows) {
      const c = finalChoice(r.marks[q.id])
      if (c === null) continue
      if (c === q.answer) correct++
      else wrong.set(c, (wrong.get(c) ?? 0) + 1)
    }
    let topWrong: ItemStat['topWrong'] = null
    for (const [choice, count] of wrong) if (!topWrong || count > topWrong.count) topWrong = { choice, count }
    return { answered: rows.length, correct, topWrong }
  })
}

function csvCell(v: string | number) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(ws: Worksheet, rows: StudentRow[]): string {
  const head = ['Name', 'Code', 'Score', 'Out of', 'Percent', ...ws.questions.map((_, i) => `Q${i + 1}`)]
  const lines = [head]
  for (const r of rows) {
    lines.push([
      r.name,
      r.code,
      String(r.score),
      String(r.max),
      r.max ? String(Math.round((100 * r.score) / r.max)) : '',
      ...ws.questions.map((q) => {
        const c = finalChoice(r.marks[q.id])
        return c === null ? '' : LETTERS[c]
      }),
    ])
  }
  lines.push(['Key', '', '', '', '', ...ws.questions.map((q) => (q.answer === null ? '' : LETTERS[q.answer]))])
  return lines.map((l) => l.map(csvCell).join(',')).join('\n')
}
