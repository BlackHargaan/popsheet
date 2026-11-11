import { describe, expect, it } from 'vitest'
import { BLANK, BLANK_INK, eraseRules, expectedAnswers, groupAnswers, inkShare, matchesExpected, normalizeAnswer } from '../src/core/groups'

describe('normalizeAnswer', () => {
  it('ignores case, spacing and a trailing full stop', () => {
    expect(normalizeAnswer('  X = 42. ')).toBe(normalizeAnswer('x=42'))
    expect(normalizeAnswer('Photosynthesis')).toBe('photosynthesis')
  })

  it('treats look-alike symbols as the same', () => {
    expect(normalizeAnswer('−5')).toBe('-5')
    expect(normalizeAnswer('3 × 4')).toBe('3x4')
  })

  it('keeps answers that differ in meaning apart', () => {
    expect(normalizeAnswer('42')).not.toBe(normalizeAnswer('24'))
    expect(normalizeAnswer('-5')).not.toBe(normalizeAnswer('5'))
    expect(normalizeAnswer('0.5')).not.toBe(normalizeAnswer('05'))
    expect(normalizeAnswer('3/4')).not.toBe(normalizeAnswer('4/3'))
  })
})

describe('groupAnswers', () => {
  it('puts matching answers together, biggest group first and blanks last', () => {
    const groups = groupAnswers([
      { code: 'A', text: 'x = 42' },
      { code: 'B', text: '' },
      { code: 'C', text: 'x=42' },
      { code: 'D', text: '24' },
      { code: 'E', text: 'X = 42.' },
    ])
    expect(groups.map((g) => g.codes)).toEqual([['A', 'C', 'E'], ['D'], ['B']])
    expect(groups[2].key).toBe(BLANK)
    expect(groups[2].label).toBe('')
  })

  it('labels a group with its most common spelling', () => {
    const [g] = groupAnswers([
      { code: 'A', text: 'x=42' },
      { code: 'B', text: 'x = 42' },
      { code: 'C', text: 'x = 42' },
    ])
    expect(g.label).toBe('x = 42')
  })
})

describe('expected answers', () => {
  it('splits several accepted answers on semicolons and ignores empty ones', () => {
    expect(expectedAnswers('x = 42;  42 ; ')).toEqual(['x = 42', '42'])
    expect(expectedAnswers(undefined)).toEqual([])
    expect(expectedAnswers(' ; ')).toEqual([])
  })

  it('matches the same answer however it is spaced or capitalised, or the same number', () => {
    const exp = expectedAnswers('x = 42; Photosynthesis; 0.5')
    expect(matchesExpected('X=42.', exp)).toBe(true)
    expect(matchesExpected('photosynthesis', exp)).toBe(true)
    expect(matchesExpected('.5', exp)).toBe(true)
    // How the reader usually sees a handwritten "x = 42".
    expect(matchesExpected('x-42', exp)).toBe(true)
  })

  it('never matches a different or blank answer', () => {
    const exp = expectedAnswers('42')
    expect(matchesExpected('24', exp)).toBe(false)
    expect(matchesExpected('x = 42', exp)).toBe(false)
    expect(matchesExpected('-42', exp)).toBe(false)
    expect(matchesExpected('', exp)).toBe(false)
    expect(matchesExpected('42', [])).toBe(false)
  })
})

describe('eraseRules', () => {
  const W = 100
  const H = 30
  const page = () => new Array(W * H).fill(240)
  const dot = (g: number[], x: number, y: number) => (g[y * W + x] = 30)

  it('removes the printed line students write on, so an unanswered box counts as blank', () => {
    const g = page()
    for (let x = 0; x < W; x++) dot(g, x, 25)
    expect(inkShare(g)).toBeGreaterThan(BLANK_INK)
    expect(inkShare(eraseRules(g, W))).toBe(0)
  })

  it('removes the sides of a printed box', () => {
    const g = page()
    for (let y = 0; y < H; y++) {
      dot(g, 0, y)
      dot(g, W - 1, y)
    }
    expect(inkShare(eraseRules(g, W))).toBe(0)
  })

  it('keeps handwriting, including where it crosses the line', () => {
    const g = page()
    for (let x = 0; x < W; x++) dot(g, x, 25)
    for (let y = 5; y < 29; y++) dot(g, 40, y) // a "1" written down through the line
    for (let x = 20; x < 32; x++) dot(g, x, 12) // a short dash
    const out = eraseRules(g, W)
    expect(out[12 * W + 25]).toBe(30)
    expect(out[10 * W + 40]).toBe(30)
    expect(out[25 * W + 70]).toBe(255)
    expect(inkShare(out)).toBeGreaterThan(BLANK_INK)
  })
})

describe('inkShare', () => {
  it('is near zero on blank paper and clearly above it with writing', () => {
    const paper = new Array(1000).fill(235)
    expect(inkShare(paper)).toBe(0)
    const written = paper.map((v, i) => (i % 25 === 0 ? 40 : v))
    expect(inkShare(written)).toBeGreaterThan(0.03)
  })
})
