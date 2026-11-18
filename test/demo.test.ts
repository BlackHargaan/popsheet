import { describe, expect, it } from 'vitest'
import { gridProblem } from '../src/core/grids'
import { layoutWarnings } from '../src/core/layoutWarnings'
import { DEMO_NAME, STUDENTS, makeDemo } from '../src/demo/demoData'

describe('demo worksheet', () => {
  it('passes the print layout checks and has a full answer key', async () => {
    const { worksheet: ws } = await makeDemo()
    expect(ws.name).toBe(DEMO_NAME)
    expect(layoutWarnings(ws)).toEqual([])
    expect(ws.questions).toHaveLength(8)
    expect(ws.questions.every((q) => q.answer !== null)).toBe(true)
    expect(ws.grids?.[0].answer).toBe('45')
    expect(ws.boxes?.map((b) => b.expected)).toEqual(['2:3; 2/3', '6 cups; 6'])
  })

  it('gives every made-up student a unique code that avoids codes already in use', async () => {
    const taken = new Set(['AAAA'])
    const { classroom } = await makeDemo(taken)
    expect(classroom.students.map((s) => s.name)).toEqual(STUDENTS.map((s) => s.name))
    const codes = classroom.students.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).not.toContain('AAAA')
  })

  it('has student work that fits the sheet and gives the tour something to show', async () => {
    const { worksheet: ws } = await makeDemo()
    const grid = ws.grids![0]
    for (const s of STUDENTS) {
      expect(s.choices).toHaveLength(ws.questions.length)
      if (s.grid) expect(gridProblem(grid, s.grid)).toBeNull()
    }
    // Question 5: the same wrong answer from most of the class, for the item analysis step.
    const q5 = STUDENTS.map((s) => s.choices[4])
    expect(q5.filter((c) => c === 0).length).toBeGreaterThan(STUDENTS.length / 2)
    // A double mark for the review step.
    expect(STUDENTS.some((s) => s.extra?.some((e) => e.kind === 'second'))).toBe(true)
  })
})
