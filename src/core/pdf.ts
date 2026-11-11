import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import {
  BUBBLE_R,
  FID_SIZE,
  QR_BOX,
  QR_QUIET_MODULES,
  bubbleCenter,
  contentPlacement,
  encodePageCode,
  fiducials,
  qrBox,
} from './layout'
import { MINUS, gridBox, gridBubble, gridColumns, writeBoxes } from './grids'
import { LETTERS } from './types'
import type { PageSize, Worksheet } from './types'

export interface Copy {
  code: string
  /** Printed next to the page code; leave empty to print the code only. */
  label: string
}

export function qrMatrix(text: string) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  return { size: qr.modules.size, data: qr.modules.data }
}

export async function readPageSizes(pdf: Uint8Array): Promise<PageSize[]> {
  const doc = await PDFDocument.load(pdf)
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize()
    return { width, height }
  })
}

function drawMarks(
  page: PDFPage,
  size: PageSize,
  ws: Worksheet,
  pageIndex: number,
  version: number,
  copy: Copy,
  font: PDFFont,
  bold: PDFFont,
) {
  const H = size.height
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)

  for (const f of fiducials(size)) {
    const pad = 5
    page.drawRectangle({
      x: f.x - FID_SIZE / 2 - pad,
      y: H - f.y - FID_SIZE / 2 - pad,
      width: FID_SIZE + 2 * pad,
      height: FID_SIZE + 2 * pad,
      color: white,
    })
    page.drawRectangle({
      x: f.x - FID_SIZE / 2,
      y: H - f.y - FID_SIZE / 2,
      width: FID_SIZE,
      height: FID_SIZE,
      color: black,
    })
  }

  // Page code
  const box = qrBox(size)
  const qr = qrMatrix(encodePageCode(ws.id, pageIndex, version, copy.code))
  const m = QR_BOX / (qr.size + 2 * QR_QUIET_MODULES)
  page.drawRectangle({ x: box.x, y: H - box.y - QR_BOX, width: QR_BOX, height: QR_BOX, color: white })
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.data[r * qr.size + c]) continue
      page.drawRectangle({
        x: box.x + (QR_QUIET_MODULES + c) * m,
        y: H - (box.y + (QR_QUIET_MODULES + r) * m) - m,
        width: m + 0.05,
        height: m + 0.05,
        color: black,
      })
    }
  }

  // Who this copy is for
  const lines = copy.label ? [copy.label, copy.code] : [copy.code]
  lines.forEach((text, i) => {
    const f = i === 0 ? bold : font
    const fs = i === 0 ? 10 : 7
    const safe = [...text].filter((ch) => ch.charCodeAt(0) < 256).join('')
    const w = f.widthOfTextAtSize(safe, fs)
    const tx = box.x - 6 - w
    const ty = H - (box.y + 22 + i * 11)
    page.drawRectangle({ x: tx - 3, y: ty - 3, width: w + 6, height: fs + 5, color: white })
    page.drawText(safe, { x: tx, y: ty, size: fs, font: f, color: black })
  })

  // Bubbles
  const qs = ws.questions.filter((q) => q.page === pageIndex)
  const grey = rgb(0.62, 0.62, 0.62)
  for (const q of qs) {
    const n = ws.questions.indexOf(q) + 1
    const first = bubbleCenter(q, 0)
    const last = bubbleCenter(q, q.choices - 1)
    const pad = 3
    page.drawRectangle({
      x: first.x - BUBBLE_R - pad,
      y: H - last.y - BUBBLE_R - pad,
      width: last.x - first.x + 2 * BUBBLE_R + 2 * pad,
      height: last.y - first.y + 2 * BUBBLE_R + 2 * pad,
      color: white,
    })
    const label = String(n)
    const lw = bold.widthOfTextAtSize(label, 8)
    if (q.dir === 'h') {
      page.drawText(label, { x: first.x - BUBBLE_R - 5 - lw, y: H - first.y - 3, size: 8, font: bold, color: black })
    } else {
      page.drawText(label, { x: first.x - lw / 2, y: H - first.y + BUBBLE_R + 4, size: 8, font: bold, color: black })
    }
    for (let i = 0; i < q.choices; i++) {
      const c = bubbleCenter(q, i)
      page.drawCircle({
        x: c.x,
        y: H - c.y,
        size: BUBBLE_R,
        borderColor: rgb(0.25, 0.25, 0.25),
        borderWidth: 0.8,
        color: white,
      })
      const ch = LETTERS[i]
      const cw = font.widthOfTextAtSize(ch, 7)
      page.drawText(ch, { x: c.x - cw / 2, y: H - c.y - 2.5, size: 7, font, color: grey })
    }
  }

  // Number grids
  for (const g of (ws.grids ?? []).filter((g) => g.page === pageIndex)) {
    // Border kept clear of the outer bubbles, where the scanner samples the paper.
    const box = gridBox(g, 7)
    page.drawRectangle({
      x: box.x,
      y: H - box.y - box.height,
      width: box.width,
      height: box.height,
      color: white,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.6,
    })
    page.drawText(g.label, { x: box.x + 5, y: H - box.y - 6 - 7, size: 8, font: bold, color: black })
    for (const w of writeBoxes(g)) {
      page.drawRectangle({
        x: w.x,
        y: H - w.y - w.height,
        width: w.width,
        height: w.height,
        borderColor: rgb(0.25, 0.25, 0.25),
        borderWidth: 0.7,
      })
    }
    for (const col of gridColumns(g)) {
      col.symbols.forEach((sym, row) => {
        const c = gridBubble(g, col, row)
        page.drawCircle({ x: c.x, y: H - c.y, size: BUBBLE_R, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.8, color: white })
        const ch = sym === MINUS ? '-' : sym
        const cw = font.widthOfTextAtSize(ch, 7)
        page.drawText(ch, { x: c.x - cw / 2, y: H - c.y - 2.5, size: 7, font, color: grey })
      })
    }
  }
}

/**
 * Builds the printable PDF: one full set of pages per copy. `version` is the printed layout version
 * (from `versionForPrint`) that goes into every page code.
 */
export async function buildPrintable(ws: Worksheet, copies: Copy[], version: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(ws.pdf)
  const out = await PDFDocument.create()
  out.setTitle(ws.name)
  const font = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const embedded = await out.embedPages(src.getPages())

  for (const copy of copies) {
    ws.pages.forEach((size, i) => {
      const page = out.addPage([size.width, size.height])
      const place = contentPlacement(size, ws.scale)
      page.drawPage(embedded[i], {
        x: place.x,
        y: size.height - place.y - place.height,
        width: place.width,
        height: place.height,
      })
      drawMarks(page, size, ws, i, version, copy, font, bold)
    })
  }
  return out.save()
}
