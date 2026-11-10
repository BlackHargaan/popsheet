import type { PageSize, Question } from './types'

/** Corner alignment squares. */
export const FID_SIZE = 14
export const FID_INSET = 30
/** Page code (QR) box, including its quiet zone. */
export const QR_BOX = 48
export const QR_QUIET_MODULES = 2
/** Bubbles. */
export const BUBBLE_R = 6.5
export const BUBBLE_SPACING = 19

export interface Pt {
  x: number
  y: number
}

/** Centres of the four alignment squares: TL, TR, BR, BL. */
export function fiducials(p: PageSize): Pt[] {
  const i = FID_INSET
  return [
    { x: i, y: i },
    { x: p.width - i, y: i },
    { x: p.width - i, y: p.height - i },
    { x: i, y: p.height - i },
  ]
}

/** Top-left corner of the page-code box. */
export function qrBox(p: PageSize): Pt {
  return { x: p.width - FID_INSET - FID_SIZE / 2 - 10 - QR_BOX, y: 18 }
}

/** Corners (TL, TR, BR, BL) of the code's module area, given its module count. */
export function qrModuleCorners(p: PageSize, modules: number): Pt[] {
  const b = qrBox(p)
  const m = QR_BOX / (modules + 2 * QR_QUIET_MODULES)
  const a = b.x + QR_QUIET_MODULES * m
  const t = b.y + QR_QUIET_MODULES * m
  const s = modules * m
  return [
    { x: a, y: t },
    { x: a + s, y: t },
    { x: a + s, y: t + s },
    { x: a, y: t + s },
  ]
}

export function bubbleCenter(q: Pick<Question, 'x' | 'y' | 'dir'>, i: number): Pt {
  return q.dir === 'h'
    ? { x: q.x + i * BUBBLE_SPACING, y: q.y }
    : { x: q.x, y: q.y + i * BUBBLE_SPACING }
}

/** Bounding box of a question's bubbles plus its number label, with padding. */
export function questionBox(q: Pick<Question, 'x' | 'y' | 'dir' | 'choices'>, pad = 4) {
  const last = bubbleCenter(q, q.choices - 1)
  return {
    x: q.x - BUBBLE_R - pad,
    y: q.y - BUBBLE_R - pad,
    width: last.x - q.x + 2 * BUBBLE_R + 2 * pad,
    height: last.y - q.y + 2 * BUBBLE_R + 2 * pad,
  }
}

/** Where the (shrunk) original page is drawn on the output page. */
export function contentPlacement(p: PageSize, scale: number) {
  return {
    x: (p.width * (1 - scale)) / 2,
    y: (p.height * (1 - scale)) / 2,
    width: p.width * scale,
    height: p.height * scale,
  }
}

export const CODE_PREFIX = 'PS1'

export function encodePageCode(worksheetId: string, page: number, studentCode: string) {
  return `${CODE_PREFIX}:${worksheetId}:${page}:${studentCode}`
}

export function decodePageCode(text: string) {
  const m = /^PS1:([A-Z0-9]+):(\d+):([A-Z0-9]+)$/.exec(text.trim())
  if (!m) return null
  return { worksheetId: m[1], page: Number(m[2]), studentCode: m[3] }
}

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export function randomId(len: number, taken?: Set<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(len))
    let s = ''
    for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length]
    if (!taken || !taken.has(s)) return s
  }
}
