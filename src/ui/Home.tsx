import { useEffect, useRef, useState } from 'react'
import { randomId } from '../core/layout'
import { readPageSizes } from '../core/pdf'
import { makeSampleWorksheet } from '../core/sample'
import type { Worksheet } from '../core/types'
import { deleteWorksheet, listScans, listWorksheets, saveWorksheet } from '../store'
import { go } from './nav'

export function Home() {
  const [items, setItems] = useState<(Worksheet & { scanned: number })[] | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const list = await listWorksheets()
    const withCounts = await Promise.all(
      list.map(async (w) => ({
        ...w,
        scanned: new Set((await listScans(w.id)).map((s) => s.studentCode)).size,
      })),
    )
    setItems(withCounts)
  }
  useEffect(() => {
    void load()
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
    void load()
  }

  return (
    <div className="narrow">
      <div className="row between">
        <h1>Worksheets</h1>
        <div className="row">
          <button onClick={() => void sample()}>Try the sample quiz</button>
          <button className="primary" onClick={() => fileRef.current?.click()}>
            New from PDF
          </button>
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
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <div className="empty">
          <h2>Turn any worksheet into a bubble sheet</h2>
          <ol>
            <li>Upload the worksheet you already use, as a PDF.</li>
            <li>Click next to each question to drop in answer bubbles, and mark the right answers.</li>
            <li>Print one coded copy per student.</li>
            <li>Scan or photograph the finished pages to get scores.</li>
          </ol>
        </div>
      )}
      <ul className="cards">
        {items?.map((w) => (
          <li key={w.id}>
            <div>
              <a className="title" href={`#/w/${w.id}`}>
                {w.name}
              </a>
              <div className="muted">
                {w.questions.length} question{w.questions.length === 1 ? '' : 's'} · {w.scanned} scanned
              </div>
            </div>
            <div className="row">
              <a className="btn" href={`#/w/${w.id}`}>
                Edit
              </a>
              <a className="btn" href={`#/w/${w.id}/print`}>
                Print
              </a>
              <a className="btn" href={`#/w/${w.id}/results`}>
                Results
              </a>
              <button className="ghost" title="Delete worksheet" onClick={() => void remove(w)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
