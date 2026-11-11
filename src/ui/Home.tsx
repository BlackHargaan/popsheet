import { useEffect, useRef, useState } from 'react'
import { randomId } from '../core/layout'
import { readPageSizes } from '../core/pdf'
import { makeSampleWorksheet } from '../core/sample'
import type { Worksheet } from '../core/types'
import { deleteWorksheet, listScans, listWorksheets, saveWorksheet } from '../store'
import { renderPdfPage } from './files'
import { Arrow } from './icons'
import { go } from './nav'

type Item = Worksheet & { scanned: number }

async function fetchItems(): Promise<Item[]> {
  const list = await listWorksheets()
  const items = await Promise.all(
    list.map(async (w) => ({
      ...w,
      scanned: new Set((await listScans(w.id)).map((s) => s.studentCode)).size,
    })),
  )
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

function Thumb({ pdf }: { pdf: Uint8Array }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    void renderPdfPage(pdf, 0, 0.6)
      .then((canvas) => {
        if (!live || !ref.current) return
        ref.current.replaceChildren(canvas)
        setReady(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [pdf])
  return (
    <>
      {!ready && <i className="ph" />}
      <div ref={ref} />
    </>
  )
}

export function Home() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetchItems().then(setItems)
  }, [])

  const create = async (file: File) => {
    setError('')
    try {
      const pdf = new Uint8Array(await file.arrayBuffer())
      const pages = await readPageSizes(pdf)
      const ws: Worksheet = {
        id: randomId(6),
        name: file.name.replace(/\.pdf$/i, ''),
        createdAt: Date.now(),
        pdf,
        pages,
        scale: 0.92,
        questions: [],
        extras: [],
      }
      await saveWorksheet(ws)
      go(`/w/${ws.id}`)
    } catch {
      setError('That file could not be opened. Worksheets need to be PDF files.')
    }
  }

  const sample = async () => {
    const ws = await makeSampleWorksheet()
    await saveWorksheet(ws)
    go(`/w/${ws.id}`)
  }

  const remove = async (w: Worksheet) => {
    if (!confirm(`Delete "${w.name}" and all of its scans?`)) return
    await deleteWorksheet(w.id)
    setItems(await fetchItems())
  }

  const pick = () => fileRef.current?.click()
  const empty = items !== null && items.length === 0

  return (
    <div
      className={'wide' + (over ? ' drop-hint' : '')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) void create(f)
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void create(f)
          e.target.value = ''
        }}
      />

      {empty ? (
        <section className="hero panel">
          <div>
            <div className="eyebrow">Paper quizzes, graded in minutes</div>
            <h1>
              Turn any worksheet into a <span className="hl">bubble sheet</span>.
            </h1>
            <p className="lede">
              Keep the worksheet you already use. Popsheet adds answer bubbles, prints a coded copy for every student,
              and grades them from a phone photo.
            </p>
            <div className="row">
              <button className="primary" onClick={pick}>
                Upload a worksheet PDF
              </button>
              <button onClick={() => void sample()}>Try the sample quiz</button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <ol className="steps">
            <li>
              <div>
                <b>Upload your worksheet</b>
                <span>Any PDF. Drop it anywhere on this page.</span>
              </div>
            </li>
            <li>
              <div>
                <b>Click to place bubbles</b>
                <span>Next to each question, then mark the right answers.</span>
              </div>
            </li>
            <li>
              <div>
                <b>Print one coded copy per student</b>
                <span>Names stay on this device; sheets carry only a code.</span>
              </div>
            </li>
            <li>
              <div>
                <b>Scan or photograph the stack</b>
                <span>Any order, any way up. Scores appear instantly.</span>
              </div>
            </li>
          </ol>
        </section>
      ) : (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">Your library</div>
              <h1>Worksheets</h1>
            </div>
            <div className="row">
              <button className="quiet" onClick={() => void sample()}>
                Add the sample quiz
              </button>
              <button className="primary" onClick={pick}>
                New from PDF
              </button>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <ul className="sheet-grid">
            {items?.map((w) => {
              const keyed = w.questions.filter((q) => q.answer !== null).length
              const status =
                w.questions.length === 0
                  ? { cls: 'todo', text: 'No bubbles yet' }
                  : keyed < w.questions.length
                    ? { cls: 'todo', text: `${w.questions.length - keyed} without an answer` }
                    : { cls: 'ready', text: 'Ready to print' }
              return (
                <li key={w.id} className="sheet">
                  <a className="thumb" href={`#/w/${w.id}`} tabIndex={-1} aria-hidden="true">
                    <Thumb pdf={w.pdf} />
                  </a>
                  <span className={'status-pill ' + status.cls}>{status.text}</span>
                  <button className="ghost del sm" title={`Delete ${w.name}`} aria-label={`Delete ${w.name}`} onClick={() => void remove(w)}>
                    ✕
                  </button>
                  <div className="sheet-body">
                    <a className="sheet-title" href={`#/w/${w.id}`}>
                      {w.name}
                    </a>
                    <div className="meta">
                      <span>
                        <b>{w.questions.length}</b> question{w.questions.length === 1 ? '' : 's'}
                      </span>
                      <span>
                        <b>{w.scanned}</b> scanned
                      </span>
                      {w.pages.length > 1 && (
                        <span>
                          <b>{w.pages.length}</b> pages
                        </span>
                      )}
                    </div>
                    <div className="acts">
                      <a className="btn sm" href={`#/w/${w.id}/print`}>
                        Print
                      </a>
                      <a className={'btn sm' + (w.scanned ? ' primary' : '')} href={`#/w/${w.id}/results`}>
                        Results {w.scanned > 0 && <Arrow />}
                      </a>
                    </div>
                  </div>
                </li>
              )
            })}
            {items && (
              <li>
                <button className="new-tile" style={{ width: '100%' }} onClick={pick}>
                  <span>
                    <span className="plus">+</span>
                    New worksheet
                    <br />
                    <span className="muted small">or drop a PDF here</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}
