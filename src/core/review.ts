import { needsReview } from './grade'
import type { StudentRow } from './grade'
import type { Worksheet } from './types'

export type ReviewReason = 'unsure' | 'multi' | 'blank' | 'number'
export type ReviewFilter = 'all' | ReviewReason
export interface ReviewTarget { code: string; qid: string; page: number; label: string; reason: ReviewReason }
export const reviewKey = (target: { code: string; qid: string }) => `${target.code}:${target.qid}`
export const reviewReason: Record<ReviewReason, string> = { unsure: 'Uncertain mark', multi: 'Multiple marks', blank: 'Blank answer', number: 'Uncertain number' }

/** Only scanned, unresolved answers enter the queue; teacher-confirmed blanks stay resolved. */
export function reviewTargets(ws: Worksheet, rows: StudentRow[], filter: ReviewFilter = 'all'): ReviewTarget[] {
  return rows.flatMap(row => {
    const targets: ReviewTarget[] = []
    ws.questions.forEach((q, i) => {
      const mark = row.marks[q.id]
      if (needsReview(mark)) targets.push({ code: row.code, qid: q.id, page: q.page, label: `Question ${i + 1}`, reason: mark.status as ReviewReason })
    })
    for (const grid of ws.grids ?? []) {
      const read = row.numbers[grid.id]
      if (read && !read.overridden && (read.status === 'review' || read.status === 'blank')) targets.push({ code: row.code, qid: grid.id, page: grid.page, label: `Number answer ${grid.label}`, reason: read.status === 'blank' ? 'blank' : 'number' })
    }
    return targets.filter(target => filter === 'all' || target.reason === filter)
  })
}
