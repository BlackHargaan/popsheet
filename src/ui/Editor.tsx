import { useEffect, useRef, useState } from 'react'
import {
  BUBBLE_R,
  BUBBLE_SPACING,
  FID_SIZE,
  QR_BOX,
  bubbleCenter,
  contentPlacement,
  fiducials,
  qrBox,
  questionBox,
  randomId,
} from '../core/layout'
import { LETTERS } from '../core/types'
import type { Question, Worksheet } from '../core/types'
import { getWorksheet, saveWorksheet } from '../store'
import { renderPdfPage } from './files'

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

interface Drag {
  id: string
  offX: number
  offY: number
  startX: number
  startY: number
  moved: boolean
  bubble: number | null
}

export function Editor({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [choices, setChoices] = useState(4)
  const [dir, setDir] = useState<'h' | 'v'>('h')
  const [selected, setSelected] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    void getWorksheet(id).then((w) => setWs(w ?? null))
  }, [id])

  const commit = (next: Worksheet) => {
    setWs(next)
    void saveWorksheet(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!ws || !selected || t.tagName === 'INPUT' || t.tagName === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        commit({ ...ws, questions: ws.questions.filter((q) => q.id !== selected) })
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (ws === undefined) return null
  if (ws === null) return <p className="narrow">That worksheet does not exist on this device.</p>

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

  const addAt = (e: React.PointerEvent) => {
    const p = toPt(e)
    const q = clamp({ id: randomId(6), page, x: p.x, y: p.y, choices, dir, answer: null, points: 1 })
    commit({ ...ws, questions: [...ws.questions, q] })
    setSelected(q.id)
  }

  const startDrag = (e: React.PointerEvent, q: Question, bubble: number | null) => {
    e.stopPropagation()
    const p = toPt(e)
    drag.current = { id: q.id, offX: p.x - q.x, offY: p.y - q.y, startX: e.clientX, startY: e.clientY, moved: false, bubble }
    svgRef.current!.setPointerCapture(e.pointerId)
    setSelected(q.id)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
    d.moved = true
    const p = toPt(e)
    setWs({
      ...ws,
      questions: ws.questions.map((q) => (q.id === d.id ? clamp({ ...q, x: p.x - d.offX, y: p.y - d.offY }) : q)),
    })
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.moved) void saveWorksheet(ws)
    else if (d.bubble !== null) setAnswer(d.id, d.bubble)
  }

  const patch = (qid: string, change: Partial<Question>) =>
    commit({ ...ws, questions: ws.questions.map((q) => (q.id === qid ? { ...q, ...change } : q)) })
  const setAnswer = (qid: string, answer: number) => patch(qid, { answer })
  const remove = (qid: string) => commit({ ...ws, questions: ws.questions.filter((q) => q.id !== qid) })

  const qr = qrBox(size)
  const unkeyed = ws.questions.filter((q) => q.answer === null).length

  return (
    <div className="editor">
      <div className="editor-main">
        <div className="toolbar">
          <input
            className="name"
            value={ws.name}
            aria-label="Worksheet name"
            onChange={(e) => commit({ ...ws, name: e.target.value })}
          />
          <label>
            Choices
            <select value={choices} onChange={(e) => setChoices(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  A–{LETTERS[n - 1]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Layout
            <select value={dir} onChange={(e) => setDir(e.target.value as 'h' | 'v')}>
              <option value="h">Across</option>
              <option value="v">Down</option>
            </select>
          </label>
          <label title="Shrinks the original page a little so the corner marks and bubbles have room">
            Worksheet size
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
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              Page {page + 1} of {ws.pages.length}
              <button disabled={page === ws.pages.length - 1} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </span>
          )}
        </div>
        <p className="hint">
          Click on the page to add bubbles for the next question. Drag to move them. Click a bubble to mark the
          correct answer.
        </p>
        <div className="page" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
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
            <rect width={size.width} height={size.height} fill="transparent" onPointerDown={addAt} className="add-layer" />
            {fiducials(size).map((f, i) => (
              <rect key={i} x={f.x - FID_SIZE / 2} y={f.y - FID_SIZE / 2} width={FID_SIZE} height={FID_SIZE} />
            ))}
            <g pointerEvents="none">
              <rect x={qr.x + 3} y={qr.y + 3} width={QR_BOX - 6} height={QR_BOX - 6} fill="#fff" stroke="#111" strokeDasharray="3 2" />
              <text x={qr.x + QR_BOX / 2} y={qr.y + QR_BOX / 2 + 2} textAnchor="middle" fontSize="6.5">
                page code
              </text>
            </g>
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
          </svg>
        </div>
      </div>

      <aside className="side">
        <div className="row between">
          <h2>Answer key</h2>
          <span className="muted">{ws.questions.length} questions</span>
        </div>
        {ws.questions.length === 0 && <p className="muted">No bubbles yet. Click on the page to add the first question.</p>}
        {unkeyed > 0 && (
          <p className="warn">
            {unkeyed} question{unkeyed === 1 ? ' has' : 's have'} no correct answer marked and won't be scored.
          </p>
        )}
        <ol className="key-list">
          {ws.questions.map((q, n) => (
            <li key={q.id} className={q.id === selected ? 'sel' : ''} onClick={() => { setSelected(q.id); setPage(q.page) }}>
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
              <input
                className="pts"
                type="number"
                min="0"
                step="0.5"
                value={q.points}
                title="Points"
                aria-label={`Question ${n + 1} points`}
                onChange={(e) => patch(q.id, { points: Math.max(0, Number(e.target.value) || 0) })}
              />
              <button className="ghost" title="Remove question" onClick={(e) => { e.stopPropagation(); remove(q.id) }}>
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="side-actions">
          <a className="btn primary" href={`#/w/${ws.id}/print`}>
            Print copies →
          </a>
          <a className="btn" href={`#/w/${ws.id}/results`}>
            Results
          </a>
        </div>
      </aside>
    </div>
  )
}
