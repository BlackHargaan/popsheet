import { useEffect, useRef, useState } from 'react'
import {
  BUBBLE_R,
  BUBBLE_SPACING,
  FID_SIZE,
  QR_BOX,
  bubbleCenter,
  boxFromPage,
  boxOnPage,
  contentPlacement,
  fiducials,
  qrBox,
  questionBox,
  randomId,
} from '../core/layout'
import { answerBubbles, gridBox, gridBubble, gridColumns, gridProblem, writeBoxes } from '../core/grids'
import { LETTERS } from '../core/types'
import type { AnswerBox, NumberGrid, Question, Worksheet } from '../core/types'
import { changedSincePrint, latestPrinted } from '../core/versions'
import { getWorksheet, saveWorksheet } from '../store'
import { renderPdfPage } from './files'
import { Arrow, Back, Missing } from './icons'

function PageBackground({ pdf, page }: { pdf: Uint8Array; page: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    void renderPdfPage(pdf, page, 2).then((canvas) => {
      if (live) ref.current?.replaceChildren(canvas)
    })
    return () => {
      live = false
    }
  }, [pdf, page])
  return <div ref={ref} className="page-bg" />
}

type Tool = 'bubbles' | 'box' | 'number'
interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type Drag =
  | { kind: 'code'; offX: number; offY: number; moved: boolean }
  | { kind: 'q'; id: string; offX: number; offY: number; startX: number; startY: number; moved: boolean; bubble: number | null }
  | { kind: 'move-box' | 'resize-box'; id: string; start: Rect; px: number; py: number; moved: boolean }
  | { kind: 'draw'; x0: number; y0: number }
  | { kind: 'grid'; id: string; offX: number; offY: number; startX: number; startY: number; moved: boolean }

/** Smallest answer box, in points on the printed page. */
const MIN_BOX = 14

export function Editor({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [tool, setTool] = useState<Tool>('bubbles')
  const [choices, setChoices] = useState(4)
  const [dir, setDir] = useState<'h' | 'v'>('h')
  const [gridCols, setGridCols] = useState(3)
  const [gridDecimal, setGridDecimal] = useState(false)
  const [gridNegative, setGridNegative] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    void getWorksheet(id).then((w) => setWs(w ?? null))
  }, [id])

  const commit = (next: Worksheet) => {
    setWs(next)
    void saveWorksheet(next)
  }

  const removeItem = (itemId: string) => {
    if (!ws) return
    commit({
      ...ws,
      questions: ws.questions.filter((q) => q.id !== itemId),
      boxes: (ws.boxes ?? []).filter((b) => b.id !== itemId),
      grids: (ws.grids ?? []).filter((g) => g.id !== itemId),
    })
    if (selected === itemId) setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!ws || !selected || t.tagName === 'INPUT' || t.tagName === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') removeItem(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (ws === undefined) return null
  if (ws === null) return <Missing />

  const boxes = ws.boxes ?? []
  const grids = ws.grids ?? []
  const size = ws.pages[page]
  const place = contentPlacement(size, ws.scale)
  const pct = (v: number, of: number) => `${(100 * v) / of}%`

  const toPt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * size.width) / r.width, y: ((e.clientY - r.top) * size.height) / r.height }
  }

  const clamp = (q: Question): Question => {
    const spanX = q.dir === 'h' ? (q.choices - 1) * BUBBLE_SPACING : 0
    const spanY = q.dir === 'v' ? (q.choices - 1) * BUBBLE_SPACING : 0
    const m = 22
    return {
      ...q,
      x: Math.max(m + 12, Math.min(size.width - m - spanX, q.x)),
      y: Math.max(m + 12, Math.min(size.height - m - spanY, q.y)),
    }
  }

  /** Keeps a box (in printed-page points) on the worksheet's own area. */
  const clampRect = (r: Rect): Rect => {
    const width = Math.max(MIN_BOX, Math.min(place.width, r.width))
    const height = Math.max(MIN_BOX, Math.min(place.height, r.height))
    return {
      x: Math.max(place.x, Math.min(place.x + place.width - width, r.x)),
      y: Math.max(place.y, Math.min(place.y + place.height - height, r.y)),
      width,
      height,
    }
  }

  /** Keeps a number grid, all of it, inside the corner marks. */
  const clampGrid = (g: NumberGrid): NumberGrid => {
    const b = gridBox(g, 3)
    const m = 22
    const dx = Math.max(m - b.x, Math.min(0, size.width - m - (b.x + b.width)))
    const dy = Math.max(m + 12 - b.y, Math.min(0, size.height - m - (b.y + b.height)))
    return { ...g, x: g.x + dx, y: g.y + dy }
  }

  const nextLabel = () => {
    const used = new Set([...boxes.map((b) => b.label), ...grids.map((g) => g.label)])
    for (let n = ws.questions.length + boxes.length + grids.length + 1; ; n++) if (!used.has(String(n))) return String(n)
  }

  const selectedGrid = grids.find((g) => g.id === selected)
  /** Toolbar choices set up the next grid, and change the selected one. */
  const gridOption = (change: Partial<Pick<NumberGrid, 'columns' | 'decimal' | 'negative'>>) => {
    if (change.columns !== undefined) setGridCols(change.columns)
    if (change.decimal !== undefined) setGridDecimal(change.decimal)
    if (change.negative !== undefined) setGridNegative(change.negative)
    if (selectedGrid) {
      const next = clampGrid({ ...selectedGrid, ...change })
      commit({ ...ws, grids: grids.map((g) => (g.id === next.id ? next : g)) })
    }
  }
  const shownCols = selectedGrid?.columns ?? gridCols
  const shownDecimal = selectedGrid?.decimal ?? gridDecimal
  const shownNegative = selectedGrid?.negative ?? gridNegative

  const onPageDown = (e: React.PointerEvent) => {
    const p = toPt(e)
    if (tool === 'box') {
      drag.current = { kind: 'draw', x0: p.x, y0: p.y }
      svgRef.current!.setPointerCapture(e.pointerId)
      setSelected(null)
      return
    }
    if (tool === 'number') {
      const g = clampGrid({
        id: randomId(6),
        page,
        x: p.x,
        y: p.y,
        label: nextLabel(),
        columns: gridCols,
        decimal: gridDecimal,
        negative: gridNegative,
        answer: null,
        points: 1,
      })
      commit({ ...ws, grids: [...grids, g] })
      setSelected(g.id)
      return
    }
    const q = clamp({ id: randomId(6), page, x: p.x, y: p.y, choices, dir, answer: null, points: 1 })
    commit({ ...ws, questions: [...ws.questions, q] })
    setSelected(q.id)
  }

  const startDrag = (e: React.PointerEvent, q: Question, bubble: number | null) => {
    e.stopPropagation()
    const p = toPt(e)
    drag.current = { kind: 'q', id: q.id, offX: p.x - q.x, offY: p.y - q.y, startX: e.clientX, startY: e.clientY, moved: false, bubble }
    svgRef.current!.setPointerCapture(e.pointerId)
    setSelected(q.id)
  }

  const startGridDrag = (e: React.PointerEvent, g: NumberGrid) => {
    e.stopPropagation()
    const p = toPt(e)
    drag.current = { kind: 'grid', id: g.id, offX: p.x - g.x, offY: p.y - g.y, startX: e.clientX, startY: e.clientY, moved: false }
    svgRef.current!.setPointerCapture(e.pointerId)
    setSelected(g.id)
  }

  const startBoxDrag = (e: React.PointerEvent, b: AnswerBox, kind: 'move-box' | 'resize-box') => {
    e.stopPropagation()
    const p = toPt(e)
    drag.current = { kind, id: b.id, start: boxOnPage(b, size, ws.scale), px: p.x, py: p.y, moved: false }
    svgRef.current!.setPointerCapture(e.pointerId)
    setSelected(b.id)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toPt(e)
    if (d.kind === 'code') {
      d.moved = true
      const pageCodes = [...(ws.pageCodes ?? [])]
      pageCodes[page] = { x: Math.max(48, Math.min(size.width - QR_BOX - 48, p.x - d.offX)), y: Math.max(18, Math.min(size.height - QR_BOX - 18, p.y - d.offY)) }
      setWs({ ...ws, pageCodes })
      return
    }
    if (d.kind === 'draw') {
      setDraft({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), width: Math.abs(p.x - d.x0), height: Math.abs(p.y - d.y0) })
      return
    }
    if (d.kind === 'grid') {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
      d.moved = true
      setWs({ ...ws, grids: grids.map((g) => (g.id === d.id ? clampGrid({ ...g, x: p.x - d.offX, y: p.y - d.offY }) : g)) })
      return
    }
    if (d.kind === 'q') {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
      d.moved = true
      setWs({
        ...ws,
        questions: ws.questions.map((q) => (q.id === d.id ? clamp({ ...q, x: p.x - d.offX, y: p.y - d.offY }) : q)),
      })
      return
    }
    d.moved = true
    const dx = p.x - d.px
    const dy = p.y - d.py
    const r =
      d.kind === 'move-box'
        ? clampRect({ ...d.start, x: d.start.x + dx, y: d.start.y + dy })
        : clampRect({ ...d.start, width: d.start.width + dx, height: d.start.height + dy })
    const stored = boxFromPage(r, size, ws.scale)
    setWs({ ...ws, boxes: boxes.map((b) => (b.id === d.id ? { ...b, ...stored } : b)) })
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.kind === 'draw') {
      const r = draft
      setDraft(null)
      if (!r || r.width < MIN_BOX || r.height < MIN_BOX) return
      const b: AnswerBox = { id: randomId(6), page, label: nextLabel(), points: 1, ...boxFromPage(clampRect(r), size, ws.scale) }
      commit({ ...ws, boxes: [...boxes, b] })
      setSelected(b.id)
      return
    }
    if (d.kind === 'q' && !d.moved) {
      if (d.bubble !== null) setAnswer(d.id, d.bubble)
      return
    }
    if (d.moved) void saveWorksheet(ws)
  }

  const patch = (qid: string, change: Partial<Question>) =>
    commit({ ...ws, questions: ws.questions.map((q) => (q.id === qid ? { ...q, ...change } : q)) })
  const patchGrid = (gid: string, change: Partial<NumberGrid>) =>
    commit({ ...ws, grids: grids.map((g) => (g.id === gid ? { ...g, ...change } : g)) })
  const patchBox = (bid: string, change: Partial<AnswerBox>) =>
    commit({ ...ws, boxes: boxes.map((b) => (b.id === bid ? { ...b, ...change } : b)) })
  const setAnswer = (qid: string, answer: number) => patch(qid, { answer })

  const qr = qrBox(size, ws.pageCodes?.[page])
  const unkeyed = ws.questions.filter((q) => q.answer === null).length
  const keyed = ws.questions.length - unkeyed
  const totalPts =
    ws.questions.reduce((s, q) => s + q.points, 0) +
    boxes.reduce((s, b) => s + b.points, 0) +
    grids.reduce((s, g) => s + g.points, 0)
  const anything = ws.questions.length + boxes.length + grids.length > 0
  const gridsUnkeyed = grids.filter((g) => g.answer === null).length
  const printed = latestPrinted(ws)

  return (
    <div className="editor">
      <div className="editor-main">
        <Back href="#/">All worksheets</Back>
        <input
          className="title-input"
          value={ws.name}
          aria-label="Worksheet name"
          onChange={(e) => commit({ ...ws, name: e.target.value })}
        />
        <div className="toolbar panel">
          <div className="seg tools" role="group" aria-label="What clicking the page adds">
            <button aria-pressed={tool === 'bubbles'} onClick={() => setTool('bubbles')} title="Multiple-choice bubbles, read by the scanner">
              <span className="tool-ic bub" aria-hidden="true" />
              Bubbles
            </button>
            <button aria-pressed={tool === 'number'} onClick={() => setTool('number')} title="A number answer: students write it, then bubble each digit">
              <span className="tool-ic num" aria-hidden="true" />
              Number
            </button>
            <button aria-pressed={tool === 'box'} onClick={() => setTool('box')} title="An area students write in, graded by you question by question">
              <span className="tool-ic box" aria-hidden="true" />
              Answer box
            </button>
          </div>
          <span className="sep" />
          {tool === 'bubbles' ? (
            <div className="group">
              <div className="seg" role="group" aria-label="Number of choices">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button key={n} aria-pressed={choices === n} onClick={() => setChoices(n)} title={`Choices A to ${LETTERS[n - 1]}`}>
                    A–{LETTERS[n - 1]}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Bubble direction">
                <button aria-pressed={dir === 'h'} onClick={() => setDir('h')} title="Bubbles in a row">
                  Across
                </button>
                <button aria-pressed={dir === 'v'} onClick={() => setDir('v')} title="Bubbles in a column">
                  Down
                </button>
              </div>
            </div>
          ) : tool === 'number' ? (
            <div className="group">
              <div className="seg" role="group" aria-label="Digits">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} aria-pressed={shownCols === n} onClick={() => gridOption({ columns: n })} title={`Up to ${n} digit${n === 1 ? '' : 's'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="lbl">digits</span>
              <label className="check">
                <input type="checkbox" checked={shownDecimal} onChange={(e) => gridOption({ decimal: e.target.checked })} />
                Decimal point
              </label>
              <label className="check">
                <input type="checkbox" checked={shownNegative} onChange={(e) => gridOption({ negative: e.target.checked })} />
                Minus sign
              </label>
            </div>
          ) : (
            <span className="muted small">Drag around the space where students write their answer.</span>
          )}
          <span className="sep" />
          <label className="group" title="Shrinks the original page a little so the corner marks and bubbles have room">
            <span className="lbl">Page size</span>
            <select value={ws.scale} onChange={(e) => commit({ ...ws, scale: Number(e.target.value) })}>
              {[1, 0.96, 0.92, 0.9, 0.85, 0.8].map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
          </label>
          {ws.pages.length > 1 && (
            <span className="pager">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                ‹
              </button>
              Page {page + 1} of {ws.pages.length}
              <button disabled={page === ws.pages.length - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
                ›
              </button>
            </span>
          )}
        </div>
        <p className="hint">
          {tool === 'bubbles' ? (
            <>
              <span>
                <b>Click</b> the page to add a question
              </span>
              <span>
                <b>Drag</b> to move it
              </span>
              <span>
                <b>Click a bubble</b> to mark the answer
              </span>
            </>
          ) : tool === 'number' ? (
            <>
              <span>
                <b>Click</b> the page to add a number grid
              </span>
              <span>
                <b>Drag</b> to move it
              </span>
              <span>Type the correct number in the list on the right</span>
            </>
          ) : (
            <>
              <span>
                <b>Drag</b> on the page to draw a box
              </span>
              <span>
                <b>Drag a box</b> to move it, or its corner to resize
              </span>
              <span>Boxes aren't printed; they tell Popsheet what to cut out for grading.</span>
            </>
          )}
          <span>
            Drag the page code to move it. <kbd>Del</kbd> removes the selected one
          </span>
        </p>
        <div className="desk">
          <div className={'page tool-' + tool} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            <div
              className="page-content"
              style={{
                left: pct(place.x, size.width),
                top: pct(place.y, size.height),
                width: pct(place.width, size.width),
                height: pct(place.height, size.height),
              }}
            >
              <PageBackground pdf={ws.pdf} page={page} />
            </div>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size.width} ${size.height}`}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <rect width={size.width} height={size.height} fill="transparent" onPointerDown={onPageDown} className="add-layer" />
              {fiducials(size).map((f, i) => (
                <rect key={i} x={f.x - FID_SIZE / 2} y={f.y - FID_SIZE / 2} width={FID_SIZE} height={FID_SIZE} />
              ))}
              <g className="page-code" onPointerDown={(e) => {
                e.stopPropagation()
                const p = toPt(e)
                drag.current = { kind: 'code', offX: p.x - qr.x, offY: p.y - qr.y, moved: false }
                svgRef.current!.setPointerCapture(e.pointerId)
                setSelected(null)
              }}>
                <title>Drag to move the page code</title>
                <rect x={qr.x} y={qr.y} width={QR_BOX} height={QR_BOX} fill="transparent" />
                <rect x={qr.x + 3} y={qr.y + 3} width={QR_BOX - 6} height={QR_BOX - 6} fill="#fff" stroke="#111" strokeDasharray="3 2" />
                <text x={qr.x + QR_BOX / 2} y={qr.y + QR_BOX / 2 + 2} textAnchor="middle" fontSize="6.5">
                  page code
                </text>
              </g>

              <g pointerEvents={tool === 'box' ? undefined : 'none'}>
                {boxes.map((b) => {
                  if (b.page !== page) return null
                  const r = boxOnPage(b, size, ws.scale)
                  const tag = `${b.label} · ${b.points} pt`
                  return (
                    <g key={b.id} className={'abox' + (b.id === selected ? ' sel' : '')} onPointerDown={(e) => startBoxDrag(e, b, 'move-box')}>
                      <rect className="abox-area" x={r.x} y={r.y} width={r.width} height={r.height} rx="2" />
                      <g className="abox-tag">
                        <rect x={r.x} y={r.y - 11} width={tag.length * 4.1 + 10} height={11} rx="2" />
                        <text x={r.x + 5} y={r.y - 3}>
                          {tag}
                        </text>
                      </g>
                      <rect
                        className="abox-handle"
                        x={r.x + r.width - 5}
                        y={r.y + r.height - 5}
                        width={10}
                        height={10}
                        rx="2"
                        onPointerDown={(e) => startBoxDrag(e, b, 'resize-box')}
                      />
                    </g>
                  )
                })}
                {draft && <rect className="abox-draft" x={draft.x} y={draft.y} width={draft.width} height={draft.height} rx="2" />}
              </g>

              <g pointerEvents={tool === 'number' ? undefined : 'none'} opacity={tool === 'number' ? 1 : 0.55}>
                {grids.map((g) => {
                  if (g.page !== page) return null
                  const box = gridBox(g, 3)
                  const key = g.answer === null ? null : answerBubbles(g, g.answer)
                  return (
                    <g key={g.id} className={'q grid' + (g.id === selected ? ' sel' : '')} onPointerDown={(e) => startGridDrag(e, g)}>
                      <rect className="q-box" x={box.x} y={box.y} width={box.width} height={box.height} rx="3" />
                      <text className="q-num" x={box.x + 4} y={box.y + 9}>
                        {g.label}
                      </text>
                      {writeBoxes(g).map((w, i) => (
                        <rect key={i} className="grid-write" x={w.x} y={w.y} width={w.width} height={w.height} />
                      ))}
                      {gridColumns(g).map((col) =>
                        col.symbols.map((sym, row) => {
                          const c = gridBubble(g, col, row)
                          return (
                            <g key={col.id + ':' + row} className={'bubble' + (key?.get(col.id) === row ? ' key' : '')}>
                              <circle cx={c.x} cy={c.y} r={BUBBLE_R} />
                              <text x={c.x} y={c.y + 2.5} textAnchor="middle">
                                {sym}
                              </text>
                            </g>
                          )
                        }),
                      )}
                    </g>
                  )
                })}
              </g>

              <g pointerEvents={tool === 'bubbles' ? undefined : 'none'} opacity={tool === 'bubbles' ? 1 : 0.55}>
                {ws.questions.map((q, n) => {
                  if (q.page !== page) return null
                  const box = questionBox(q, 3)
                  const first = bubbleCenter(q, 0)
                  return (
                    <g key={q.id} className={'q' + (q.id === selected ? ' sel' : '')} onPointerDown={(e) => startDrag(e, q, null)}>
                      <rect
                        className="q-box"
                        x={box.x - (q.dir === 'h' ? 14 : 0)}
                        y={box.y - (q.dir === 'v' ? 12 : 0)}
                        width={box.width + (q.dir === 'h' ? 14 : 0)}
                        height={box.height + (q.dir === 'v' ? 12 : 0)}
                        rx="3"
                      />
                      <text
                        className="q-num"
                        x={q.dir === 'h' ? first.x - BUBBLE_R - 5 : first.x}
                        y={q.dir === 'h' ? first.y + 3 : first.y - BUBBLE_R - 4}
                        textAnchor={q.dir === 'h' ? 'end' : 'middle'}
                      >
                        {n + 1}
                      </text>
                      {Array.from({ length: q.choices }, (_, i) => {
                        const c = bubbleCenter(q, i)
                        return (
                          <g key={i} className={'bubble' + (q.answer === i ? ' key' : '')} onPointerDown={(e) => startDrag(e, q, i)}>
                            <circle cx={c.x} cy={c.y} r={BUBBLE_R} />
                            <text x={c.x} y={c.y + 2.5} textAnchor="middle">
                              {LETTERS[i]}
                            </text>
                          </g>
                        )
                      })}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </div>
      </div>

      <aside className="side panel">
        <div className="side-head">
          <div className="row between">
            <h2>Answer key</h2>
            <span className="muted small">
              {keyed} of {ws.questions.length} marked
            </span>
          </div>
          {ws.questions.length > 0 && (
            <div className={'progress' + (unkeyed === 0 ? ' done' : '')} aria-hidden="true">
              <i style={{ width: `${(100 * keyed) / ws.questions.length}%` }} />
            </div>
          )}
        </div>
        <div className="side-scroll">
          {printed && changedSincePrint(ws) && (
            <p className="notice small">
              Changed since you printed version {printed.version}. Sheets already printed still scan correctly; print
              again to give students the new layout.
            </p>
          )}
          {!anything && (
            <div className="side-empty">
              <div className="ill" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              No questions yet.
              <br />
              Click next to the first question on the page.
            </div>
          )}
          {unkeyed > 0 && (
            <p className="warn">
              {unkeyed} question{unkeyed === 1 ? ' has' : 's have'} no correct answer and won't be scored.
            </p>
          )}
          <ol className="key-list">
            {ws.questions.map((q, n) => (
              <li
                key={q.id}
                className={(q.id === selected ? 'sel' : '') + (q.answer === null ? ' unkeyed' : '')}
                onClick={() => {
                  setSelected(q.id)
                  setPage(q.page)
                  setTool('bubbles')
                }}
              >
                <span className="num">{n + 1}</span>
                <span className="letters">
                  {Array.from({ length: q.choices }, (_, i) => (
                    <button
                      key={i}
                      className={'letter' + (q.answer === i ? ' on' : '')}
                      aria-pressed={q.answer === i}
                      aria-label={`Question ${n + 1} answer ${LETTERS[i]}`}
                      onClick={() => setAnswer(q.id, i)}
                    >
                      {LETTERS[i]}
                    </button>
                  ))}
                </span>
                <label className="pts" title="Points">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={q.points}
                    aria-label={`Question ${n + 1} points`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patch(q.id, { points: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  pt
                </label>
                <button
                  className="ghost sm"
                  title="Remove question"
                  aria-label={`Remove question ${n + 1}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeItem(q.id)
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>

          {(grids.length > 0 || tool === 'number') && (
            <>
              <h3 className="side-sub">Number answers</h3>
              {grids.length === 0 && <p className="muted small">Click the page where a number answer should go.</p>}
              {gridsUnkeyed > 0 && (
                <p className="warn">
                  {gridsUnkeyed} number answer{gridsUnkeyed === 1 ? ' has' : 's have'} no correct number and won't be scored.
                </p>
              )}
              <ol className="key-list">
                {grids.map((g) => {
                  const problem = g.answer === null ? null : gridProblem(g, g.answer)
                  return (
                    <li
                      key={g.id}
                      className={(g.id === selected ? 'sel' : '') + (g.answer === null ? ' unkeyed' : '')}
                      onClick={() => {
                        setSelected(g.id)
                        setPage(g.page)
                        setTool('number')
                      }}
                    >
                      <span className="num-ic" aria-hidden="true">
                        #
                      </span>
                      <label className="box-label">
                        <span className="muted small">Q</span>
                        <input
                          value={g.label}
                          aria-label="Question label"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patchGrid(g.id, { label: e.target.value.slice(0, 8) })}
                        />
                      </label>
                      <span className="grow grid-answer">
                        <input
                          value={g.answer ?? ''}
                          placeholder="Answer"
                          inputMode="decimal"
                          aria-label={`Question ${g.label} correct number`}
                          aria-invalid={!!problem}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patchGrid(g.id, { answer: e.target.value.trim() === '' ? null : e.target.value.trim() })}
                        />
                        {problem && <span className="field-warn">{problem}</span>}
                      </span>
                      <label className="pts" title="Points">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={g.points}
                          aria-label={`Question ${g.label} points`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patchGrid(g.id, { points: Math.max(0, Number(e.target.value) || 0) })}
                        />
                        pt
                      </label>
                      <button
                        className="ghost sm"
                        title="Remove number grid"
                        aria-label={`Remove number grid ${g.label}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeItem(g.id)
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          )}

          {(boxes.length > 0 || tool === 'box') && (
            <>
              <h3 className="side-sub">Written answers</h3>
              {boxes.length === 0 && <p className="muted small">Drag on the page around the space where students write.</p>}
              <ol className="key-list">
                {boxes.map((b) => (
                  <li
                    key={b.id}
                    className={b.id === selected ? 'sel' : ''}
                    onClick={() => {
                      setSelected(b.id)
                      setPage(b.page)
                      setTool('box')
                    }}
                  >
                    <span className="box-ic" aria-hidden="true" />
                    <label className="box-label">
                      <span className="muted small">Q</span>
                      <input
                        value={b.label}
                        aria-label="Question label"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBox(b.id, { label: e.target.value.slice(0, 8) })}
                      />
                    </label>
                    <span className="grow expected">
                      <input
                        value={b.expected ?? ''}
                        placeholder="Expected answer"
                        aria-label={`Question ${b.label} expected answer`}
                        title="What a full-marks answer says. Separate other accepted answers with ; (e.g. x = 42; 42). Matching answers are suggested for full marks when you grade."
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBox(b.id, { expected: e.target.value || undefined })}
                      />
                    </span>
                    <label className="pts" title="Points">
                      <input
                        type="number"
                        min="1"
                        max="9"
                        step="1"
                        value={b.points}
                        aria-label={`Question ${b.label} points`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBox(b.id, { points: Math.max(1, Math.min(9, Math.round(Number(e.target.value)) || 1)) })}
                      />
                      pt
                    </label>
                    <button
                      className="ghost sm"
                      title="Remove answer box"
                      aria-label={`Remove answer box ${b.label}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeItem(b.id)
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        {anything && (
          <div className="side-total">
            <span>Total</span>
            <b>
              {totalPts} point{totalPts === 1 ? '' : 's'}
            </b>
          </div>
        )}
        <div className="side-actions">
          <a className="btn" href={`#/w/${ws.id}/results`}>
            Results
          </a>
          <a className="btn primary" href={`#/w/${ws.id}/print`}>
            Print copies <Arrow />
          </a>
        </div>
      </aside>
    </div>
  )
}
