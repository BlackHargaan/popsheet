import { boxOnPage, contentPlacement, questionBox } from './layout'
import { gridBox } from './grids'
import type { Worksheet } from './types'

export function editorItems(ws: Worksheet, page: number) {
  return [
    ...ws.questions.filter(q => q.page === page).map(q => ({ id: q.id, ...questionBox(q) })),
    ...(ws.grids ?? []).filter(g => g.page === page).map(g => ({ id: g.id, ...gridBox(g, 3) })),
    ...(ws.boxes ?? []).filter(b => b.page === page).map(b => ({ id: b.id, ...boxOnPage(b, ws.pages[page], ws.scale) })),
  ]
}

/** Apply one shared, bounded translation so a group keeps its spacing. */
export function moveItems(ws: Worksheet, page: number, ids: string[], dx: number, dy: number) {
  const items = editorItems(ws, page).filter(i => ids.includes(i.id))
  const size = ws.pages[page]
  const place = contentPlacement(size, ws.scale)
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity
  for (const item of items) {
    const box = ws.boxes?.some(b => b.id === item.id)
    const area = box ? place : { x: 22, y: 34, width: size.width - 44, height: size.height - 56 }
    minX = Math.max(minX, area.x - item.x)
    maxX = Math.min(maxX, area.x + area.width - item.x - item.width)
    minY = Math.max(minY, area.y - item.y)
    maxY = Math.min(maxY, area.y + area.height - item.y - item.height)
  }
  dx = Math.max(minX, Math.min(maxX, dx)); dy = Math.max(minY, Math.min(maxY, dy))
  const chosen = (i: { id: string; page: number }) => i.page === page && ids.includes(i.id)
  return { ...ws,
    questions: ws.questions.map(q => chosen(q) ? { ...q, x: q.x + dx, y: q.y + dy } : q),
    grids: ws.grids?.map(g => chosen(g) ? { ...g, x: g.x + dx, y: g.y + dy } : g),
    boxes: ws.boxes?.map(b => chosen(b) ? { ...b, x: b.x + dx / ws.scale, y: b.y + dy / ws.scale } : b),
  }
}

/** Snap the moving group's edges and centre to stationary items. */
export function snapItems(ws: Worksheet, page: number, ids: string[], dx: number, dy: number) {
  const items = editorItems(ws, page)
  const moving = items.filter(i => ids.includes(i.id))
  const still = items.filter(i => !ids.includes(i.id))
  let x: number | undefined, y: number | undefined
  let bestX = 5, bestY = 5, correctionX = 0, correctionY = 0
  for (const a of moving) for (const b of still) {
    for (const [av, bv] of [[a.x, b.x], [a.x + a.width / 2, b.x + b.width / 2], [a.x + a.width, b.x + b.width]]) {
      const gap = bv - av - dx
      if (Math.abs(gap) < bestX) {
        bestX = Math.abs(gap)
        correctionX = gap
        x = bv
      }
    }
    for (const [av, bv] of [[a.y, b.y], [a.y + a.height / 2, b.y + b.height / 2], [a.y + a.height, b.y + b.height]]) {
      const gap = bv - av - dy
      if (Math.abs(gap) < bestY) {
        bestY = Math.abs(gap)
        correctionY = gap
        y = bv
      }
    }
  }
  return { dx: dx + correctionX, dy: dy + correctionY, x, y }
}
