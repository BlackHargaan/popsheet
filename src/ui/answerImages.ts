import { BLANK_INK, eraseRules, inkShare } from '../core/groups'
import { boxOnPage } from '../core/layout'
import type { AnswerBox, Reading, ScanRecord, Worksheet } from '../core/types'
import { scaleForScan } from '../core/versions'
import { cropScan } from './files'

/** Extra room around the drawn box, in points, so answers that spill over the line still show. */
export const PAD = 6

/** Where one answer box sits on a stored scan, in points, with some room around it. */
export function answerRect(ws: Worksheet, rec: ScanRecord, box: AnswerBox, pad = PAD) {
  const r = boxOnPage(box, ws.pages[box.page], scaleForScan(ws, rec.version))
  return { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad }
}

/** Identifies a box's place, so a reading taken before the box was moved is read again. */
export const boxSignature = (b: AnswerBox) => `${b.page}:${b.x},${b.y},${b.width},${b.height}`

/** True when the reading still matches the scan and the box it came from. */
export const isFresh = (r: Reading | undefined, rec: ScanRecord, box: AnswerBox) =>
  !!r && r.scannedAt === rec.scannedAt && r.box === boxSignature(box)

/** The answer as an image for the handwriting reader, or null when nothing is written there. */
export async function answerImage(ws: Worksheet, rec: ScanRecord, box: AnswerBox): Promise<Blob | null> {
  const bmp = await cropScan(rec.image!, rec.ppp!, answerRect(ws, rec, box, 2))
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0)
  bmp.close()
  const data = g.getImageData(0, 0, c.width, c.height)
  const px = data.data
  const raw = new Uint8Array(c.width * c.height)
  for (let i = 0; i < raw.length; i++) raw[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10
  const gray = eraseRules(raw, c.width)
  if (inkShare(gray) < BLANK_INK) return null
  for (let i = 0; i < gray.length; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i]
  g.putImageData(data, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

