import { useEffect, useRef, useState } from 'react'
import { buildRows, finalChoice, itemStats, needsReview, toCsv } from '../core/grade'
import type { StudentRow } from '../core/grade'
import { LETTERS } from '../core/types'
import type { ClassRoom, Mark, Question, ScanRecord, Worksheet } from '../core/types'
import { deleteStudentScans, getScan, getWorksheet, listClasses, listScans, saveScan } from '../store'
import { download } from './files'

function Crop({ crop }: { crop: NonNullable<Mark['crop']> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    c.width = crop.width
    c.height = crop.height
    const img = new ImageData(crop.width, crop.height)
    for (let i = 0; i < crop.data.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = crop.data[i]
      img.data[i * 4 + 3] = 255
    }
    c.getContext('2d')!.putImageData(img, 0, 0)
  }, [crop])
  return <canvas ref={ref} className="crop" />
}

interface Target {
  code: string
  qid: string
}

export function Results({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  const [queue, setQueue] = useState(false)

  const load = async () => {
    setWs((await getWorksheet(id)) ?? null)
    setScans(await listScans(id))
    setClasses(await listClasses())
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const rows = ws ? buildRows(ws, scans, classes) : []
  const flaggedList: Target[] = []
  if (ws) for (const r of rows) for (const q of ws.questions) if (needsReview(r.marks[q.id])) flaggedList.push({ code: r.code, qid: q.id })

  const decide = async (t: Target, q: Question, choice: number | null) => {
    const rec = await getScan(id, t.code, q.page)
    if (!rec || !rec.marks[q.id]) return
    rec.marks[q.id] = { ...rec.marks[q.id], override: choice }
    await saveScan(rec)
    const fresh = await listScans(id)
    setScans(fresh)
    if (queue && ws) {
      const next = buildRows(ws, fresh, classes).flatMap((r) =>
        ws.questions.filter((qq) => needsReview(r.marks[qq.id])).map((qq) => ({ code: r.code, qid: qq.id })),
      )[0]
      setTarget(next ?? null)
      if (!next) setQueue(false)
    } else setTarget(null)
  }

  const row = target && rows.find((r) => r.code === target.code)
  const question = target && ws?.questions.find((q) => q.id === target.qid)
  const mark = row && question ? row.marks[question.id] : undefined

  useEffect(() => {
    if (!target || !question) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTarget(null)
        setQueue(false)
        return
      }
      const i = LETTERS.indexOf(e.key.toUpperCase())
      if (e.key.length === 1 && i >= 0 && i < question.choices) void decide(target, question, i)
      else if (e.key === '0' || e.key === ' ') {
        e.preventDefault()
        void decide(target, question, null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (ws === undefined) return null
  if (ws === null) return <p className="narrow">That worksheet does not exist on this device.</p>

  const stats = itemStats(ws, rows)
  const avg = rows.length && rows[0].max ? rows.reduce((s, r) => s + r.score / r.max, 0) / rows.length : null

  const removeRow = async (r: StudentRow) => {
    if (!confirm(`Remove the scan for ${r.name}?`)) return
    await deleteStudentScans(id, r.code)
    void load()
  }

  const cell = (r: StudentRow, q: Question) => {
    const m = r.marks[q.id]
    if (!m) return <td key={q.id} className="c none" title="Page not scanned">·</td>
    const c = finalChoice(m)
    const cls = needsReview(m) ? 'flag' : c === null ? 'blank' : q.answer === null ? 'plain' : c === q.answer ? 'right' : 'wrong'
    const label = needsReview(m) ? (m.status === 'multi' ? '2+' : m.status === 'blank' ? '–' : `${LETTERS[m.choice ?? 0]}?`) : c === null ? '–' : LETTERS[c]
    return (
      <td key={q.id} className={`c ${cls}`}>
        <button onClick={() => { setQueue(false); setTarget({ code: r.code, qid: q.id }) }} title="Check this answer">
          {label}
        </button>
      </td>
    )
  }

  return (
    <div className="results">
      <a href={`#/w/${ws.id}`}>← {ws.name}</a>
      <div className="row between">
        <h1>Results</h1>
        <div className="row">
          {flaggedList.length > 0 && (
            <button className="primary" onClick={() => { setQueue(true); setTarget(flaggedList[0]) }}>
              Check {flaggedList.length} flagged answer{flaggedList.length === 1 ? '' : 's'}
            </button>
          )}
          <a className="btn" href="#/scan">
            Scan more
          </a>
          <button disabled={rows.length === 0} onClick={() => download(`${ws.name} - results.csv`, toCsv(ws, rows), 'text/csv')}>
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          No sheets scanned yet. <a href="#/scan">Scan finished sheets</a> and the scores will show up here.
        </div>
      ) : (
        <>
          <p className="muted">
            {rows.length} student{rows.length === 1 ? '' : 's'}
            {avg !== null && <> · class average {Math.round(avg * 100)}%</>}
            {flaggedList.length > 0 && <> · scores may change once flagged answers are checked</>}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="l">Student</th>
                  <th>Score</th>
                  {ws.questions.map((q, i) => (
                    <th key={q.id}>
                      {i + 1}
                      <div className="keyletter">{q.answer === null ? '?' : LETTERS[q.answer]}</div>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="l">
                      {r.name}
                      {r.pagesScanned.length < ws.pages.length && <span className="tag">missing a page</span>}
                    </td>
                    <td className="score">
                      {r.score}/{r.max}
                      {r.max > 0 && <span className="muted"> {Math.round((100 * r.score) / r.max)}%</span>}
                    </td>
                    {ws.questions.map((q) => cell(r, q))}
                    <td>
                      <button className="ghost" title="Remove this scan" onClick={() => void removeRow(r)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">Correct</td>
                  <td />
                  {stats.map((s, i) => {
                    const p = s.answered ? Math.round((100 * s.correct) / s.answered) : 0
                    return (
                      <td key={i} className={'stat' + (p < 50 ? ' low' : '')}>
                        {ws.questions[i].answer === null ? '' : `${p}%`}
                      </td>
                    )
                  })}
                  <td />
                </tr>
                <tr>
                  <td className="l">Most common wrong answer</td>
                  <td />
                  {stats.map((s, i) => (
                    <td key={i} className="stat">
                      {s.topWrong && ws.questions[i].answer !== null ? `${LETTERS[s.topWrong.choice]} ×${s.topWrong.count}` : ''}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {target && row && question && mark && (
        <div className="modal-back" onClick={() => { setTarget(null); setQueue(false) }}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="muted">
              {row.name} · Question {ws.questions.indexOf(question) + 1}
              {queue && <> · {flaggedList.length} left</>}
            </div>
            <h2>
              {mark.status === 'multi' ? 'More than one bubble looks filled' : mark.status === 'blank' ? 'No bubble looks filled' : mark.status === 'unsure' ? 'This mark is hard to read' : 'What did the student answer?'}
            </h2>
            {mark.crop && <Crop crop={mark.crop} />}
            <div className="row center">
              {Array.from({ length: question.choices }, (_, i) => (
                <button key={i} className={'letter big' + (!needsReview(mark) && finalChoice(mark) === i ? ' on' : '')} onClick={() => void decide(target, question, i)}>
                  {LETTERS[i]}
                </button>
              ))}
              <button className={'big' + (!needsReview(mark) && finalChoice(mark) === null ? ' on' : '')} onClick={() => void decide(target, question, null)}>
                No answer
              </button>
            </div>
            <p className="muted small">Keyboard: press the letter, or 0 for no answer. Esc closes.</p>
          </div>
        </div>
      )}
    </div>
  )
}
