import { boxOnPage, contentPlacement, questionBox, randomId } from './layout'
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

/** Copies selected answer items at a consistent row/column spacing, with fresh IDs and labels. */
export function duplicateItems(ws: Worksheet, page: number, ids: string[], count = 1, direction: 'down' | 'across' = 'down') {
  const selected = editorItems(ws, page).filter(item => ids.includes(item.id))
  if (!selected.length || !Number.isInteger(count) || count < 1 || count > 20) throw new Error('Select items and choose between 1 and 20 copies.')
  const spanX = Math.max(...selected.map(i => i.x + i.width)) - Math.min(...selected.map(i => i.x)) + 12
  const spanY = Math.max(...selected.map(i => i.y + i.height)) - Math.min(...selected.map(i => i.y)) + 12
  let next = ws
  let lastIds: string[] = []
  const taken = new Set([...ws.questions, ...(ws.boxes ?? []), ...(ws.grids ?? [])].map(i => i.id))
  const labels = new Set([...(ws.boxes ?? []), ...(ws.grids ?? [])].map(i => i.label))
  let number = ws.questions.length + (ws.boxes?.length ?? 0) + (ws.grids?.length ?? 0) + 1
  const label = () => { while (labels.has(String(number))) number++; const text = String(number++); labels.add(text); return text }
  for (let n = 1; n <= count; n++) {
    const mapping = new Map(selected.map(i => { const id = randomId(6, taken); taken.add(id); return [i.id, id] }))
    const clone = <T extends { id: string; page: number }>(items: T[]) => items.filter(i => i.page === page && mapping.has(i.id)).map(i => ({ ...i, id: mapping.get(i.id)! }))
    const questions = clone(ws.questions)
    const boxes = clone(ws.boxes ?? []).map(b => ({ ...b, label: label() }))
    const grids = clone(ws.grids ?? []).map(g => ({ ...g, label: label() }))
    next = { ...next, questions: [...next.questions, ...questions], boxes: [...(next.boxes ?? []), ...boxes], grids: [...(next.grids ?? []), ...grids] }
    lastIds = [...mapping.values()]
    const dx = direction === 'across' ? spanX * n : 0, dy = direction === 'down' ? spanY * n : 0
    const moved = moveItems(next, page, lastIds, dx, dy)
    const before = editorItems(next, page).find(i => i.id === lastIds[0])!
    const after = editorItems(moved, page).find(i => i.id === lastIds[0])!
    if (Math.abs(after.x - before.x - dx) > .01 || Math.abs(after.y - before.y - dy) > .01) throw new Error('Not enough room for those copies. Try fewer copies, another direction, or move the selection first.')
    next = moved
  }
  return { ws: next, ids: lastIds }
}

/** A reusable worksheet copy starts with its key and layout, without student or scan history. */
export function duplicateWorksheet(ws: Worksheet): Worksheet {
  const taken = new Set<string>()
  const freshId = () => {
    const id = randomId(6, taken)
    taken.add(id)
    return id
  }
  return {
    id: randomId(6),
    name: `${ws.name} (copy)`,
    createdAt: Date.now(),
    pdf: ws.pdf,
    pages: ws.pages.map(page => ({ ...page })),
    scale: ws.scale,
    pageCodes: ws.pageCodes?.map(position => position ? { ...position } : null),
    extras: [],
    questions: ws.questions.map(q => ({ ...q, id: freshId() })),
    boxes: ws.boxes?.map(b => ({ ...b, id: freshId() })),
    grids: ws.grids?.map(g => ({ ...g, id: freshId() })),
  }
}
