import { reviewKey, reviewReason, reviewTargets } from '../core/review'
import type { ReviewFilter } from '../core/review'
import { useEffect, useRef, useState } from 'react'
import { boxesOf, buildRows, finalChoice, gridRight, gridsOf, itemStats, needsReview, toCsv } from '../core/grade'
import type { StudentRow } from '../core/grade'
import { layoutForScan } from '../core/versions'
import { gridBox, parseNumber, sameNumber } from '../core/grids'
import { LETTERS } from '../core/types'
import type { AnswerBox, BoxGrades, ClassRoom, Mark, NumberGrid, Question, ScanRecord, Worksheet } from '../core/types'
import { deleteStudentScans, getBoxGrades, getScan, getWorksheet, listClasses, listScans, saveScan } from '../store'
import { cropScan, download } from './files'
import { Arrow, Back, Missing } from './icons'

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

/** A number grid cut out of the stored page image, for checking what the student wrote and bubbled. */
function GridCrop({ rec, grid, ws }: { rec: ScanRecord | undefined; grid: NumberGrid; ws: Worksheet }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!rec?.image || !rec.ppp) return
    let live = true
    const geometry = layoutForScan(ws, rec.version ?? null)?.grids.find(g => g.id === grid.id) ?? grid
    void cropScan(rec.image, rec.ppp, gridBox(geometry, 6)).then((bmp) => {
      const c = ref.current
      if (!live || !c) return bmp.close()
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')!.drawImage(bmp, 0, 0)
      bmp.close()
    })
    return () => {
      live = false
    }
  }, [rec, grid, ws])
  if (!rec?.image) return null
  return <canvas ref={ref} className="crop grid-crop" />
}

export function Results({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [grades, setGrades] = useState<BoxGrades>({})
  const [target, setTarget] = useState<Target | null>(null)
  const [queue, setQueue] = useState(false)
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [skipped, setSkipped] = useState<string[]>([])
  const [reviewed, setReviewed] = useState(0)
  const [queueTotal, setQueueTotal] = useState(0)
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)

  const load = async () => {
    setWs((await getWorksheet(id)) ?? null)
    setScans(await listScans(id))
    setClasses(await listClasses())
    setGrades(await getBoxGrades(id))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const rows = ws ? buildRows(ws, scans, classes, grades) : []
  const allFlagged = ws ? reviewTargets(ws, rows) : []
  const flaggedList = ws ? reviewTargets(ws, rows, filter) : []
  const pending = flaggedList.filter(t => !skipped.includes(reviewKey(t)))
  const progress = queue ? `${reviewed} reviewed · ${skipped.length} skipped · ${pending.length} remaining of ${queueTotal}` : null
  const startQueue = () => {
    setSkipped([]); setReviewed(0); setQueueTotal(flaggedList.length)
    setReviewMessage(''); setReviewError(''); setQueue(true); setTarget(flaggedList[0] ?? null)
  }
  const skip = () => {
    if (!target || saving) return
    const nextSkipped = [...skipped, reviewKey(target)]
    setSkipped(nextSkipped)
    const next = flaggedList.find(t => !nextSkipped.includes(reviewKey(t)))
    setTarget(next ?? null)
    if (!next) { setQueue(false); setReviewMessage(`Reviewed ${reviewed} answers. ${nextSkipped.length} skipped for now; they remain in the review queue.`) }
  }

  /** After a correction: on to the next flagged answer when working through the queue, else close. */
  const afterDecision = async () => {
    const fresh = await listScans(id)
    setScans(fresh)
    if (queue && ws) {
      const next = reviewTargets(ws, buildRows(ws, fresh, classes, grades), filter).find(t => !skipped.includes(reviewKey(t)))
      setReviewed(n => n + 1)
      setTarget(next ?? null)
      if (!next) { setQueue(false); setReviewMessage(`Reviewed ${reviewed + 1} answers.${skipped.length ? ` ${skipped.length} skipped for now; they remain in the review queue.` : ' Review complete.'}`) }
    } else setTarget(null)
  }

  const saveDecision = async (action: () => Promise<void>) => {
    if (saveLock.current) return
    saveLock.current = true; setSaving(true); setReviewError('')
    try { await action(); await afterDecision() }
    catch { setReviewError('Could not save this correction. Please try again.') }
    finally { saveLock.current = false; setSaving(false) }
  }

  const decide = (t: Target, q: Question, choice: number | null) => saveDecision(async () => {
    const rec = await getScan(id, t.code, q.page)
    if (!rec || !rec.marks[q.id]) throw new Error('Missing scan')
    rec.marks[q.id] = { ...rec.marks[q.id], override: choice }
    await saveScan(rec)
  })

  const decideNumber = (t: Target, g: NumberGrid, value: string | null | undefined) => saveDecision(async () => {
    const rec = await getScan(id, t.code, g.page)
    if (!rec) throw new Error('Missing scan')
    const numbers = { ...rec.numbers }
    if (value === undefined) delete numbers[g.id]
    else numbers[g.id] = value
    rec.numbers = numbers
    await saveScan(rec)
  })

  const row = target && rows.find((r) => r.code === target.code)
  const question = target && ws?.questions.find((q) => q.id === target.qid)
  const mark = row && question ? row.marks[question.id] : undefined
  const grid = target && ws ? gridsOf(ws).find((g) => g.id === target.qid) : undefined

  useEffect(() => {
    if (!target || !question) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (saving) return
        setTarget(null)
        setQueue(false)
        return
      }
      const i = LETTERS.indexOf(e.key.toUpperCase())
      if (saving || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key.length === 1 && i >= 0 && i < question.choices) void decide(target, question, i)
      else if (e.key === '0' || (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON')) {
        e.preventDefault()
        void decide(target, question, null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (ws === undefined) return null
  if (ws === null) return <Missing />

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

  const grids = gridsOf(ws)
  const gridCell = (r: StudentRow, g: NumberGrid) => {
    const n = r.numbers[g.id]
    if (!n) return <td key={g.id} className="c none" title="Page not scanned">·</td>
    const cls = n.status === 'review' ? 'flag' : n.text === null ? 'blank' : g.answer === null ? 'plain' : gridRight(g, n) ? 'right' : 'wrong'
    const label = n.text === null ? '–' : n.status === 'review' ? `${n.text}?` : n.text
    return (
      <td key={g.id} className={`c n ${cls}`}>
        <button onClick={() => { setQueue(false); setTarget({ code: r.code, qid: g.id }) }} title="Check this answer">
          {label}
        </button>
      </td>
    )
  }
  const gridStats = grids.map((g) => {
    const read = rows.map((r) => r.numbers[g.id]).filter((n) => n && n.status !== 'review')
    const right = read.filter((n) => gridRight(g, n)).length
    const wrong = new Map<string, number>()
    for (const n of read) if (n!.text !== null && g.answer !== null && !sameNumber(n!.text, g.answer)) wrong.set(n!.text, (wrong.get(n!.text) ?? 0) + 1)
    const top = [...wrong.entries()].sort((a, b) => b[1] - a[1])[0]
    return { p: read.length && g.answer !== null ? Math.round((100 * right) / read.length) : null, top }
  })

  const boxes = boxesOf(ws)
  const ungraded = rows.reduce((s, r) => s + r.ungraded, 0)
  const firstUngraded = boxes.find((b) => rows.some((r) => r.pagesScanned.includes(b.page) && r.boxScores[b.id] === undefined))
  const boxCell = (r: StudentRow, b: AnswerBox) => {
    const href = `#/w/${ws.id}/grade/${b.id}/${r.code}`
    if (!r.pagesScanned.includes(b.page)) return <td key={b.id} className="c none" title="Page not scanned">·</td>
    const sc = r.boxScores[b.id]
    const cls = sc === undefined ? 'todo' : sc >= b.points ? 'right' : sc === 0 ? 'wrong' : 'part'
    return (
      <td key={b.id} className={`c w ${cls}`}>
        <a href={href} title={sc === undefined ? 'Grade this answer' : 'Change this score'}>
          {sc === undefined ? '?' : sc}
        </a>
      </td>
    )
  }

  const pcts = rows.filter((r) => r.max > 0).map((r) => r.score / r.max)
  const bins = Array.from({ length: 10 }, (_, i) => pcts.filter((p) => Math.min(9, Math.floor(p * 10)) === i).length)
  const binMax = Math.max(1, ...bins)
  const hardest = stats
    .map((s, i) => ({ i, p: s.answered && ws.questions[i].answer !== null ? s.correct / s.answered : null }))
    .filter((x): x is { i: number; p: number } => x.p !== null)
    .sort((a, b) => a.p - b.p)[0]
  const median = pcts.length ? [...pcts].sort((a, b) => a - b)[Math.floor((pcts.length - 1) / 2)] : null

  return (
    <div className="results">
      <Back href={`#/w/${ws.id}`}>{ws.name}</Back>
      <div className="page-head">
        <div>
          <div className="eyebrow">Results</div>
          <h1>{ws.name}</h1>
        </div>
        <div className="row">
          <a className="btn quiet" href="#/scan">
            Scan more
          </a>
          <button disabled={rows.length === 0} onClick={() => download(`${ws.name} - results.csv`, toCsv(ws, rows), 'text/csv')}>
            Export CSV
          </button>
          {firstUngraded && (
            <a className={'btn' + (flaggedList.length ? '' : ' hi')} href={`#/w/${ws.id}/grade/${firstUngraded.id}`}>
              Grade {ungraded} written answer{ungraded === 1 ? '' : 's'}
            </a>
          )}
          {flaggedList.length > 0 && (
            <button className="hi" onClick={startQueue}>
              Check {flaggedList.length} flagged answer{flaggedList.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      {rows.length > 0 && <section className="panel pad review-queue" aria-label="Scan review queue">
        <div className="row between"><div><h2>Scan review queue</h2><p>{allFlagged.length} answers need a check. Confirm the answer or skip it for now.</p></div>
          <label className="group">Show <select aria-label="Review filter" value={filter} onChange={e => { setFilter(e.target.value as ReviewFilter); setSkipped([]); setReviewMessage('') }}>
            <option value="all">All flagged answers</option>
            {(['unsure', 'multi', 'blank', 'number'] as const).map(reason => <option key={reason} value={reason}>{reviewReason[reason]} ({allFlagged.filter(t => t.reason === reason).length})</option>)}
          </select></label>
          <button className="primary" disabled={!flaggedList.length} onClick={startQueue}>Review {flaggedList.length} answers</button>
        </div>
        {reviewMessage && <p role="status">{reviewMessage}</p>}
        {flaggedList.length > 0 && <details><summary>See answers to review</summary><ul className="review-list">{flaggedList.map(t => <li key={reviewKey(t)}>
          <button className="link" onClick={() => { setQueue(false); setReviewError(''); setTarget(t) }}>{rows.find(r => r.code === t.code)?.name} · {t.label} · Page {t.page + 1}</button><span className="tag">{reviewReason[t.reason]}</span>
        </li>)}</ul></details>}
        {!allFlagged.length && <p>No scan answers need review.</p>}
      </section>}
      {rows.length === 0 ? (
        <div className="panel empty-state">
          <div className="ill" aria-hidden="true">
            <i />
            <i className="f" />
            <i />
            <i />
          </div>
          <h2>No sheets scanned yet</h2>
          <p>Once students have filled in their copies, scan or photograph them and the scores will show up here.</p>
          <a className="btn primary" href="#/scan">
            Scan finished sheets <Arrow />
          </a>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="panel stat-tile">
              <div className="v">
                {avg === null ? '–' : Math.round(avg * 100)}
                <small>%</small>
              </div>
              <div className="k">Class average{median !== null && ` · median ${Math.round(median * 100)}%`}</div>
            </div>
            <div className="panel stat-tile">
              <div className="v">{rows.length}</div>
              <div className="k">Student{rows.length === 1 ? '' : 's'} scanned</div>
            </div>
            <div className="panel stat-tile">
              <div className="dist" aria-label="Score distribution">
                {bins.map((b, i) => (
                  <i key={i} className={b ? '' : 'z'} style={{ height: `${(100 * b) / binMax}%` }} title={`${i * 10}–${i === 9 ? 100 : i * 10 + 9}%: ${b}`} />
                ))}
              </div>
              <div className="dist-axis">
                <span>0%</span>
                <span>Spread of scores</span>
                <span>100%</span>
              </div>
            </div>
            {allFlagged.length > 0 || ungraded > 0 ? (
              <div className="panel stat-tile alert">
                <div className="v">{allFlagged.length + ungraded}</div>
                <div className="k">
                  {[
                    allFlagged.length > 0 && `${allFlagged.length} mark${allFlagged.length === 1 ? '' : 's'} to check`,
                    ungraded > 0 && `${ungraded} to grade`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  · scores may change
                </div>
              </div>
            ) : (
              hardest && (
                <div className="panel stat-tile">
                  <div className="v">
                    Q{hardest.i + 1}
                    <small> {Math.round(hardest.p * 100)}%</small>
                  </div>
                  <div className="k">Hardest question</div>
                </div>
              )
            )}
          </div>
          <div className="legend">
            <span className="right">
              <i /> Right
            </span>
            <span className="wrong">
              <i /> Wrong
            </span>
            <span className="blank">
              <i /> Left blank
            </span>
            <span className="flag">
              <i /> Needs a look
            </span>
            {boxes.length > 0 && (
              <span className="part">
                <i /> Part marks
              </span>
            )}
            <span>Click any answer to correct it.</span>
          </div>
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th className="l sticky">Student</th>
                  <th className="l">Score</th>
                  {ws.questions.map((q, i) => (
                    <th key={q.id}>
                      {i + 1}
                      <div>
                        <span className={'keyletter' + (q.answer === null ? ' none' : '')} title={q.answer === null ? 'No answer marked' : 'Correct answer'}>
                          {q.answer === null ? '?' : LETTERS[q.answer]}
                        </span>
                      </div>
                    </th>
                  ))}
                  {grids.map((g) => (
                    <th key={g.id} className="ncol" title="Number answer">
                      {g.label}
                      <div>
                        <span className={'keyletter num' + (g.answer === null ? ' none' : '')} title={g.answer === null ? 'No correct number set' : 'Correct number'}>
                          {g.answer ?? '?'}
                        </span>
                      </div>
                    </th>
                  ))}
                  {boxes.map((b) => (
                    <th key={b.id} className="wcol" title={`Written answer, out of ${b.points}`}>
                      {b.label}
                      <div>
                        <span className="keyletter pts">/{b.points}</span>
                      </div>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = r.max > 0 ? r.score / r.max : null
                  return (
                  <tr key={r.code}>
                    <td className="l sticky">
                      <span className="who">{r.name}</span>
                      {r.pagesScanned.length < ws.pages.length && <span className="tag">missing a page</span>}
                    </td>
                    <td className="score-cell">
                      <div className="score-line">
                        <span className="pct">{p === null ? '–' : `${Math.round(p * 100)}%`}</span>
                        <span className="bar" aria-hidden="true">
                          <i className={p === null ? '' : p < 0.5 ? 'lo' : p >= 0.85 ? 'hiq' : ''} style={{ width: `${(p ?? 0) * 100}%` }} />
                        </span>
                        <span className="raw">
                          {r.score}/{r.max}
                        </span>
                      </div>
                    </td>
                    {ws.questions.map((q) => cell(r, q))}
                    {grids.map((g) => gridCell(r, g))}
                    {boxes.map((b) => boxCell(r, b))}
                    <td>
                      <button className="ghost sm" title="Remove this scan" aria-label={`Remove the scan for ${r.name}`} onClick={() => void removeRow(r)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l sticky">Got it right</td>
                  <td />
                  {stats.map((s, i) => {
                    const p = s.answered ? Math.round((100 * s.correct) / s.answered) : 0
                    return (
                      <td key={i} className={'stat' + (p < 50 ? ' low' : '')}>
                        {ws.questions[i].answer === null ? '' : `${p}%`}
                      </td>
                    )
                  })}
                  {gridStats.map((s, i) => (
                    <td key={grids[i].id} className={'stat' + (s.p !== null && s.p < 50 ? ' low' : '')}>
                      {s.p === null ? '' : `${s.p}%`}
                    </td>
                  ))}
                  {boxes.map((b) => {
                    const got = rows.map((r) => r.boxScores[b.id]).filter((v): v is number => v !== undefined)
                    const p = got.length ? Math.round((100 * got.reduce((a, v) => a + v, 0)) / (got.length * b.points)) : null
                    return (
                      <td key={b.id} className={'stat' + (p !== null && p < 50 ? ' low' : '')} title="Average share of the points">
                        {p === null ? '' : `${p}%`}
                      </td>
                    )
                  })}
                  <td />
                </tr>
                <tr>
                  <td className="l sticky">Most common wrong answer</td>
                  <td />
                  {stats.map((s, i) => (
                    <td key={i} className="stat">
                      {s.topWrong && ws.questions[i].answer !== null ? `${LETTERS[s.topWrong.choice]} ×${s.topWrong.count}` : ''}
                    </td>
                  ))}
                  {gridStats.map((s, i) => (
                    <td key={grids[i].id} className="stat">
                      {s.top ? `${s.top[0]} ×${s.top[1]}` : ''}
                    </td>
                  ))}
                  {boxes.map((b) => (
                    <td key={b.id} />
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {target && row && grid && (
        <NumberReview
          key={target.code + grid.id}
          name={row.name}
          grid={grid}
          ws={ws}
          read={row.numbers[grid.id]}
          rec={scans.find((s) => s.studentCode === row.code && s.page === grid.page)}
          progress={progress}
          saving={saving}
          error={reviewError}
          onSkip={queue ? skip : undefined}
          onDecide={(v) => void decideNumber(target, grid, v)}
          onClose={() => {
            setTarget(null)
            setQueue(false)
          }}
        />
      )}

      {target && row && question && mark && (
        <div className="modal-back" onClick={() => { if (!saving) { setTarget(null); setQueue(false) } }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Review answer" onClick={(e) => e.stopPropagation()}>
            <div className="crumbs">
              <b>{row.name}</b>
              <span>Question {ws.questions.indexOf(question) + 1}</span>
              {progress && <span className="left">{progress}</span>}
            </div>
            <h2>
              {mark.status === 'multi' ? 'More than one bubble looks filled' : mark.status === 'blank' ? 'No bubble looks filled' : mark.status === 'unsure' ? 'This mark is hard to read' : 'What did the student answer?'}
            </h2>
            {mark.crop ? <Crop crop={mark.crop} /> : <p className="muted small">No answer image is stored for this scan. Check the student’s sheet before confirming.</p>}
            <div className="row center keys">
              {Array.from({ length: question.choices }, (_, i) => (
                <button key={i} disabled={saving} className={'letter big' + (!needsReview(mark) && finalChoice(mark) === i ? ' on' : '')} onClick={() => void decide(target, question, i)}>
                  {LETTERS[i]}
                </button>
              ))}
              <button disabled={saving} className={'big' + (!needsReview(mark) && finalChoice(mark) === null ? ' on' : '')} onClick={() => void decide(target, question, null)}>
                No answer
              </button>
            </div>
            {reviewError && <p className="error" role="alert">{reviewError}</p>}
            <div className="row center review-actions">{queue && <button disabled={saving} onClick={skip}>Skip for now</button>}<button disabled={saving} onClick={() => { if (!saving) { setTarget(null); setQueue(false) } }}>Close review</button></div>
            <p className="muted small" style={{ marginTop: '1rem' }}>
              Press <kbd>A</kbd>–<kbd>{LETTERS[question.choices - 1]}</kbd>, <kbd>0</kbd> for no answer, <kbd>Esc</kbd> to close.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function NumberReview({
  name,
  grid,
  ws,
  read,
  rec,
  progress,
  saving,
  error,
  onSkip,
  onDecide,
  onClose,
}: {
  name: string
  grid: NumberGrid
  ws: Worksheet
  read: StudentRow['numbers'][string] | undefined
  rec: ScanRecord | undefined
  progress: string | null
  saving: boolean
  error: string
  onSkip?: () => void
  onDecide: (value: string | null | undefined) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(read?.text ?? '')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const valid = value.trim() === '' || parseNumber(value) !== null
  return (
    <div className="modal-back" onClick={() => { if (!saving) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Review number answer" onClick={(e) => e.stopPropagation()}>
        <div className="crumbs">
          <b>{name}</b>
          <span>Question {grid.label}</span>
          {progress && <span className="left">{progress}</span>}
        </div>
        <h2>{read?.status === 'review' ? 'This number is hard to read' : 'What number did the student answer?'}</h2>
        <GridCrop rec={rec} grid={grid} ws={ws} />
        {!rec?.image && <p className="muted small">No page image is stored for this scan. Check the student’s sheet before confirming.</p>}
        <form
          className="row center keys"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !saving) onDecide(value.trim() === '' ? null : value.trim())
          }}
        >
          <input
            className="number-input"
            autoFocus
            value={value}
            inputMode="decimal"
            aria-label="The student's answer"
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="primary big" type="submit" disabled={!valid || saving}>
            Save
          </button>
          <button className="big" type="button" disabled={saving} onClick={() => onDecide(null)}>
            No answer
          </button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row center review-actions">{onSkip && <button disabled={saving} onClick={onSkip}>Skip for now</button>}<button disabled={saving} onClick={onClose}>Close review</button></div>
        <p className="muted small" style={{ marginTop: '1rem' }}>
          {read?.overridden ? (
            <>
              You corrected this.{' '}
              <button className="link" disabled={saving} onClick={() => onDecide(undefined)}>
                Use the scanner's reading again
              </button>
            </>
          ) : (
            <>
              Type the number the student meant, then <kbd>Enter</kbd>. <kbd>Esc</kbd> closes.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
