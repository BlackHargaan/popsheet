import { boxOnPage, bubbleCenter, BUBBLE_R } from '../core/layout'
import { buildPrintable } from '../core/pdf'
import { answerBubbles, gridBubble, gridColumns, writeBoxes } from '../core/grids'
import type { ClassRoom, Worksheet } from '../core/types'
import { latestPrinted } from '../core/versions'
import { renderPdfPage } from '../ui/files'
import { STUDENTS } from './demoData'
import type { StudentWork } from './demoData'

/**
 * Makes the "phone photos" for the demo: each student's printed sheet, filled in with pencil, then laid on a
 * desk at a slight angle with uneven light. The photos go through the real scanner, exactly like a teacher's.
 */

/** Pixels per point the sheets are drawn at before being "photographed". */
const K = 2

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

type Ctx = CanvasRenderingContext2D

/** A pencil-filled bubble: a dark disc with a few uneven strokes so it doesn't look stamped. */
function fillBubble(g: Ctx, x: number, y: number, rand: () => number, level = 1) {
  const r = BUBBLE_R * K
  g.save()
  g.globalAlpha = 0.86 * level
  g.fillStyle = '#2e2c2a'
  g.beginPath()
  g.ellipse(x + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2, r * (0.86 + rand() * 0.1), r * (0.84 + rand() * 0.1), rand() * 3, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 0.5 * level
  g.strokeStyle = '#2e2c2a'
  g.lineWidth = 2.2
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI
    g.beginPath()
    g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r * 0.9)
    g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r)
    g.stroke()
  }
  g.restore()
}

/** An erased mark: a faint grey smudge where a bubble was filled and rubbed out. */
function smudge(g: Ctx, x: number, y: number, rand: () => number) {
  g.save()
  g.globalAlpha = 0.16
  g.fillStyle = '#4a4744'
  g.beginPath()
  g.ellipse(x, y, BUBBLE_R * K * 0.9, BUBBLE_R * K * 0.75, rand(), 0, Math.PI * 2)
  g.fill()
  g.restore()
}

const HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"

/** Writing in a student's hand: a bit of slant, wobble and uneven spacing per letter. */
function write(g: Ctx, text: string, x: number, y: number, size: number, rand: () => number) {
  g.save()
  g.fillStyle = '#34312e'
  g.font = `${size}px ${HAND}`
  g.textBaseline = 'alphabetic'
  let cx = x
  for (const ch of text) {
    g.save()
    g.translate(cx, y + (rand() - 0.5) * size * 0.12)
    g.rotate((rand() - 0.5) * 0.14 - 0.04)
    g.globalAlpha = 0.85 + rand() * 0.15
    g.fillText(ch, 0, 0)
    g.restore()
    cx += g.measureText(ch).width * (0.96 + rand() * 0.12)
  }
  g.restore()
}

/** Draws one student's answers onto their rendered sheet. Coordinates are printed-page points. */
function fillIn(g: Ctx, ws: Worksheet, work: StudentWork, rand: () => number) {
  ws.questions.forEach((q, i) => {
    const choice = work.choices[i]
    const light = work.light?.includes(i) ? 0.55 : 1
    if (choice !== null && choice !== undefined) {
      const c = bubbleCenter(q, choice)
      fillBubble(g, c.x * K, c.y * K, rand, light)
    }
    for (const e of work.extra ?? []) {
      if (e.q !== i) continue
      const c = bubbleCenter(q, e.choice)
      if (e.kind === 'second') fillBubble(g, c.x * K, c.y * K, rand)
      else smudge(g, c.x * K, c.y * K, rand)
    }
  })

  for (const grid of ws.grids ?? []) {
    if (!work.grid) continue
    // Write the digits right-aligned in the boxes, then fill the matching bubble in each column.
    const boxes = writeBoxes(grid)
    const digits = [...work.grid]
    const start = boxes.length - digits.length
    digits.forEach((d, i) => {
      const b = boxes[start + i]
      write(g, d, (b.x + b.width * 0.24) * K, (b.y + b.height * 0.8) * K, 13 * K, rand)
    })
    const filled = answerBubbles(grid, work.grid)
    if (!filled) continue
    for (const col of gridColumns(grid)) {
      const row = filled.get(col.id)
      if (row === undefined) continue
      const p = gridBubble(grid, col, row)
      fillBubble(g, p.x * K, p.y * K, rand)
    }
  }

  const size = ws.pages[0]
  ;(ws.boxes ?? []).forEach((box, i) => {
    const text = work.written[i]
    if (!text) return
    const r = boxOnPage(box, size, ws.scale)
    write(g, text, (r.x + 10 + rand() * 30) * K, (r.y + r.height * 0.68) * K, 19 * K, rand)
  })
}

/** Lays the sheet on a desk, turned a little, with a shadow and a lamp off to one side. */
function photograph(sheet: HTMLCanvasElement, rand: () => number, upsideDown: boolean): HTMLCanvasElement {
  const W = 1500
  const H = 1900
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const desk = g.createLinearGradient(0, 0, W, H)
  desk.addColorStop(0, '#8a6a4c')
  desk.addColorStop(1, '#5d4532')
  g.fillStyle = desk
  g.fillRect(0, 0, W, H)

  const fit = Math.min((W * 0.88) / sheet.width, (H * 0.88) / sheet.height)
  g.save()
  g.translate(W / 2 + (rand() - 0.5) * 60, H / 2 + (rand() - 0.5) * 60)
  g.rotate(((rand() - 0.5) * 7 * Math.PI) / 180 + (upsideDown ? Math.PI : 0))
  g.scale(fit, fit)
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 30
  g.shadowOffsetX = 10
  g.shadowOffsetY = 14
  g.drawImage(sheet, -sheet.width / 2, -sheet.height / 2)
  g.restore()

  // Uneven light: brighter near the lamp, darker across the far corner.
  const lx = rand() * W
  const light = g.createRadialGradient(lx, 0, 100, lx, 0, H * 1.25)
  light.addColorStop(0, 'rgba(255,248,230,0.10)')
  light.addColorStop(1, 'rgba(20,12,0,0.30)')
  g.fillStyle = light
  g.fillRect(0, 0, W, H)
  return c
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the photo.'))), 'image/jpeg', 0.86))

export interface DemoPhoto {
  file: File
  name: string
  /** A small picture for the tour to show. */
  thumb: string
}

/** Prints the demo class's sheets, fills each one in as its student would, and photographs it. */
export async function makeDemoPhotos(ws: Worksheet, cls: ClassRoom, onProgress?: (done: number) => void): Promise<DemoPhoto[]> {
  const version = latestPrinted(ws)?.version ?? 1
  const photos: DemoPhoto[] = []
  for (let i = 0; i < cls.students.length; i++) {
    const student = cls.students[i]
    const work = STUDENTS.find((s) => s.name === student.name)
    if (!work) continue
    const pdf = await buildPrintable(ws, [{ code: student.code, label: student.name }], version)
    const sheet = await renderPdfPage(pdf, 0, K)
    const rand = seeded(1000 + i * 77)
    fillIn(sheet.getContext('2d')!, ws, work, rand)
    // One student hands their sheet in upside down; the scanner doesn't mind.
    const photo = photograph(sheet, rand, i === 3)
    const blob = await toJpeg(photo)
    const t = document.createElement('canvas')
    t.width = 150
    t.height = 190
    t.getContext('2d')!.drawImage(photo, 0, 0, t.width, t.height)
    photos.push({
      file: new File([blob], `IMG_${2401 + i}.jpg`, { type: 'image/jpeg' }),
      name: student.name,
      thumb: t.toDataURL('image/jpeg', 0.7),
    })
    onProgress?.(photos.length)
  }
  return photos
}
