import { boxOnPage, FID_SIZE, fiducials, QR_BOX, qrBox, questionBox } from './layout'
import { gridBox } from './grids'
import type { Worksheet } from './types'

export interface LayoutWarning { page: number; message: string; ids: string[] }
interface Rect { x: number; y: number; width: number; height: number }
export function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Check printed geometry, including labels and the white clearing areas around marks. */
export function layoutWarnings(ws: Worksheet): LayoutWarning[] {
  return ws.pages.flatMap((size, page) => {
    const warnings: LayoutWarning[] = []
    const code = { ...qrBox(size, ws.pageCodes?.[page]), width: QR_BOX, height: QR_BOX }
    const items = [
      ...ws.questions.flatMap((q, i) => {
        if (q.page !== page) return []
        const box = questionBox(q, 3)
        return [{ id: q.id, label: `Question ${i + 1}`, ...box, x: box.x - (q.dir === 'h' ? 18 : 0), y: box.y - (q.dir === 'v' ? 12 : 0), width: box.width + (q.dir === 'h' ? 18 : 0), height: box.height + (q.dir === 'v' ? 12 : 0) }]
      }),
      ...(ws.grids ?? []).filter(g => g.page === page).map(g => ({ id: g.id, label: `Number answer ${g.label}`, ...gridBox(g, 7) })),
      { id: 'page-code', label: 'Page code', ...code },
    ]
    const corners = fiducials(size).map(p => ({ x: p.x - FID_SIZE / 2 - 5, y: p.y - FID_SIZE / 2 - 5, width: FID_SIZE + 10, height: FID_SIZE + 10 }))
    for (let i = 0; i < items.length; i++) {
      const a = items[i]
      if (a.x < 12 || a.y < 12 || a.x + a.width > size.width - 12 || a.y + a.height > size.height - 12) warnings.push({ page, ids: [a.id], message: `${a.label} is close to a page edge and may be clipped by the printer.` })
      if (corners.some(c => overlaps(a, c))) warnings.push({ page, ids: [a.id], message: `${a.label} overlaps a corner alignment mark. Move it away so the sheet can be scanned.` })
      for (const b of items.slice(i + 1)) if (overlaps(a, b)) warnings.push({ page, ids: [a.id, b.id], message: `${a.label} overlaps ${b.label.toLowerCase()}.` })
    }
    for (const b of (ws.boxes ?? []).filter(b => b.page === page)) {
      const box = boxOnPage(b, size, ws.scale)
      if (overlaps(box, code)) warnings.push({ page, ids: [b.id, 'page-code'], message: `Page code covers written answer ${b.label}.` })
    }
    return warnings
  })
}

/** Detect actual ink in the original PDF underneath the code's white background. */
export function codeCoversInk(ws: Worksheet, page: number, image: { width: number; height: number; data: Uint8ClampedArray }) {
  const size = ws.pages[page], code = qrBox(size, ws.pageCodes?.[page])
  const left = size.width * (1 - ws.scale) / 2, top = size.height * (1 - ws.scale) / 2
  const x0 = Math.max(0, Math.floor((code.x - left) / ws.scale * image.width / size.width))
  const y0 = Math.max(0, Math.floor((code.y - top) / ws.scale * image.height / size.height))
  const x1 = Math.min(image.width, Math.ceil((code.x + QR_BOX - left) / ws.scale * image.width / size.width))
  const y1 = Math.min(image.height, Math.ceil((code.y + QR_BOX - top) / ws.scale * image.height / size.height))
  let ink = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * image.width + x) * 4
    if (image.data[i + 3] > 128 && Math.min(image.data[i], image.data[i + 1], image.data[i + 2]) < 150 && ++ink >= 12) return true
  }
  return false
}
