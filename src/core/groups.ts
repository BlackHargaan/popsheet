/**
 * Grouping identical written answers, so the teacher grades each distinct answer once.
 *
 * Answers are grouped by what they say, after smoothing over differences that never change the meaning of a
 * short answer: case, spacing, a trailing full stop, and look-alike symbols (− – for minus, × for x, etc.).
 * Anything else stays apart. A wrong merge would give a student someone else's mark, so when in doubt the
 * answers stay in separate groups and the teacher grades both.
 */

import { sameNumber } from './grids'

export const BLANK = ''

export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[−–—]/g, '-') // minus, en dash, em dash
    .replace(/[×]/g, 'x') // multiplication sign
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, '')
    .replace(/[.,;:]+$/, '')
}

/** The accepted answers a teacher typed for a box, split on semicolons. */
export function expectedAnswers(text: string | undefined): string[] {
  return (text ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => normalizeAnswer(s) !== BLANK)
}

/**
 * True when an answer says the same as one of the expected answers: the same text once case, spacing and
 * look-alike symbols are smoothed over, or the same number ("0.5" and ".5"). A blank answer never matches.
 */
export function matchesExpected(text: string, expected: string[]): boolean {
  const key = normalizeAnswer(text)
  if (key === BLANK) return false
  // The handwriting reader often reads "=" as "-", so "x = 42" comes back as "x-42". For a suggestion
  // (which the teacher confirms against the student's writing) the two count as the same.
  const loose = (s: string) => s.replace(/=/g, '-')
  return expected.some((e) => loose(normalizeAnswer(e)) === loose(key) || sameNumber(e, text))
}

export interface AnswerGroup {
  /** Normalized text; BLANK for answers with nothing written. */
  key: string
  /** How the answer is shown: the most common way it was read. */
  label: string
  codes: string[]
}

/**
 * Groups students' answers by what they say. Largest groups first (they save the most time); blank answers
 * last. Within a group, students keep the order they were given in.
 */
export function groupAnswers(answers: { code: string; text: string }[]): AnswerGroup[] {
  const groups = new Map<string, { codes: string[]; spellings: Map<string, number> }>()
  for (const a of answers) {
    const key = normalizeAnswer(a.text)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { codes: [], spellings: new Map() }))
    g.codes.push(a.code)
    const shown = a.text.trim().replace(/\s+/g, ' ')
    g.spellings.set(shown, (g.spellings.get(shown) ?? 0) + 1)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      codes: g.codes,
    }))
    .sort((a, b) => {
      if ((a.key === BLANK) !== (b.key === BLANK)) return a.key === BLANK ? 1 : -1
      return b.codes.length - a.codes.length || a.label.localeCompare(b.label)
    })
}

/**
 * Share of the crop that is ink (pixels clearly darker than the paper), for spotting answers left blank
 * without running the reader. `gray` is 0 (black) to 255 (white).
 */
export function inkShare(gray: ArrayLike<number>): number {
  if (!gray.length) return 0
  const level = inkLevel(gray)
  let ink = 0
  for (let i = 0; i < gray.length; i++) if (gray[i] < level) ink++
  return ink / gray.length
}

/** Pixels darker than this are ink: well below the paper (the 60th percentile, as most of a box is paper). */
function inkLevel(gray: ArrayLike<number>) {
  const sorted = Array.from(gray).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.6)] - 70
}

/**
 * Removes printed rules from an answer crop: the line students write on, or the sides of a printed box.
 * They are not part of the answer, but would stop a blank answer looking blank and confuse the reader.
 * A rule is a straight run of ink across most of the box (40% of the width, or 85% of the height);
 * handwriting rarely makes one. Returns a copy, `width` pixels per row.
 */
export function eraseRules(gray: ArrayLike<number>, width: number): Uint8Array {
  const out = Uint8Array.from(gray)
  const height = Math.floor(out.length / width)
  if (!width || !height) return out
  const level = inkLevel(gray)
  const erase = (start: number, len: number, step: number) => {
    for (let k = 0; k < len; k++) out[start + k * step] = 255
  }
  const minH = Math.max(12, Math.round(width * 0.4))
  for (let y = 0; y < height; y++) {
    let run = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && gray[y * width + x] < level) run++
      else {
        if (run >= minH) erase(y * width + x - run, run, 1)
        run = 0
      }
    }
  }
  const minV = Math.max(12, Math.round(height * 0.85))
  for (let x = 0; x < width; x++) {
    let run = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && gray[y * width + x] < level) run++
      else {
        if (run >= minV) erase((y - run) * width + x, run, width)
        run = 0
      }
    }
  }
  return out
}

/** Below this share of ink, an answer box is treated as left blank. */
export const BLANK_INK = 0.003
