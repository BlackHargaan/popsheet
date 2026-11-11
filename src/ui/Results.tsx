import { useEffect, useRef, useState } from 'react'
import { boxesOf, buildRows, finalChoice, gridRight, gridsOf, itemStats, needsReview, toCsv } from '../core/grade'
import type { StudentRow } from '../core/grade'
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
function GridCrop({ rec, grid }: { rec: ScanRecord | undefined; grid: NumberGrid }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!rec?.image || !rec.ppp) return
    let live = true
    void cropScan(rec.image, rec.ppp, gridBox(grid, 6)).then((bmp) => {
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
  }, [rec, grid])
  if (!rec?.image) return null
  return <canvas ref={ref} className="crop grid-crop" />
}

/** Every answer the scanner wasn't sure about, in table order. */
function flaggedOf(ws: Worksheet, rows: StudentRow[]): Target[] {
  return rows.flatMap((r) => [
    ...ws.questions.filter((q) => needsReview(r.marks[q.id])).map((q) => ({ code: r.code, qid: q.id })),
    ...gridsOf(ws)
      .filter((g) => r.numbers[g.id]?.status === 'review')
      .map((g) => ({ code: r.code, qid: g.id })),
  ])
}

export function Results({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [grades, setGrades] = useState<BoxGrades>({})
  const [target, setTarget] = useState<Target | null>(null)
  const [queue, setQueue] = useState(false)

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
  const flaggedList = ws ? flaggedOf(ws, rows) : []

  /** After a correction: on to the next flagged answer when working through the queue, else close. */
  const afterDecision = async () => {
    const fresh = await listScans(id)
    setScans(fresh)
    if (queue && ws) {
      const next = flaggedOf(ws, buildRows(ws, fresh, classes, grades))[0]
      setTarget(next ?? null)
      if (!next) setQueue(false)
    } else setTarget(null)
  }

  const decide = async (t: Target, q: Question, choice: number | null) => {
    const rec = await getScan(id, t.code, q.page)
    if (!rec || !rec.marks[q.id]) return
    rec.marks[q.id] = { ...rec.marks[q.id], override: choice }
    await saveScan(rec)
    await afterDecision()
  }

  /** Sets what a student answered in a number grid (null = no answer, undefined = back to the scanner's reading). */
  const decideNumber = async (t: Target, g: NumberGrid, value: string | null | undefined) => {
    const rec = await getScan(id, t.code, g.page)
    if (!rec) return
    const numbers = { ...rec.numbers }
    if (value === undefined) delete numbers[g.id]
    else numbers[g.id] = value
    rec.numbers = numbers
    await saveScan(rec)
    await afterDecision()
  }

  const row = target && rows.find((r) => r.code === target.code)
  const question = target && ws?.questions.find((q) => q.id === target.qid)
  const mark = row && question ? row.marks[question.id] : undefined
  const grid = target && ws ? gridsOf(ws).find((g) => g.id === target.qid) : undefined

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
            <button className="hi" onClick={() => { setQueue(true); setTarget(flaggedList[0]) }}>
              Check {flaggedList.length} flagged answer{flaggedList.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

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
            {flaggedList.length > 0 || ungraded > 0 ? (
              <div className="panel stat-tile alert">
                <div className="v">{flaggedList.length + ungraded}</div>
                <div className="k">
                  {[
                    flaggedList.length > 0 && `${flaggedList.length} mark${flaggedList.length === 1 ? '' : 's'} to check`,
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
          read={row.numbers[grid.id]}
          rec={scans.find((s) => s.studentCode === row.code && s.page === grid.page)}
          left={queue ? flaggedList.length : null}
          onDecide={(v) => void decideNumber(target, grid, v)}
          onClose={() => {
            setTarget(null)
            setQueue(false)
          }}
        />
      )}

      {target && row && question && mark && (
        <div className="modal-back" onClick={() => { setTarget(null); setQueue(false) }}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="crumbs">
              <b>{row.name}</b>
              <span>Question {ws.questions.indexOf(question) + 1}</span>
              {queue && <span className="left">{flaggedList.length} left</span>}
            </div>
            <h2>
              {mark.status === 'multi' ? 'More than one bubble looks filled' : mark.status === 'blank' ? 'No bubble looks filled' : mark.status === 'unsure' ? 'This mark is hard to read' : 'What did the student answer?'}
            </h2>
            {mark.crop && <Crop crop={mark.crop} />}
            <div className="row center keys">
              {Array.from({ length: question.choices }, (_, i) => (
                <button key={i} className={'letter big' + (!needsReview(mark) && finalChoice(mark) === i ? ' on' : '')} onClick={() => void decide(target, question, i)}>
                  {LETTERS[i]}
                </button>
              ))}
              <button className={'big' + (!needsReview(mark) && finalChoice(mark) === null ? ' on' : '')} onClick={() => void decide(target, question, null)}>
                No answer
              </button>
            </div>
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
  read,
  rec,
  left,
  onDecide,
  onClose,
}: {
  name: string
  grid: NumberGrid
  read: StudentRow['numbers'][string] | undefined
  rec: ScanRecord | undefined
  left: number | null
  onDecide: (value: string | null | undefined) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(read?.text ?? '')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const valid = value.trim() === '' || parseNumber(value) !== null
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="crumbs">
          <b>{name}</b>
          <span>Question {grid.label}</span>
          {left !== null && <span className="left">{left} left</span>}
        </div>
        <h2>{read?.status === 'review' ? 'This number is hard to read' : 'What number did the student answer?'}</h2>
        <GridCrop rec={rec} grid={grid} />
        <form
          className="row center keys"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onDecide(value.trim() === '' ? null : value.trim())
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
          <button className="primary big" type="submit" disabled={!valid}>
            Save
          </button>
          <button className="big" type="button" onClick={() => onDecide(null)}>
            No answer
          </button>
        </form>
        <p className="muted small" style={{ marginTop: '1rem' }}>
          {read?.overridden ? (
            <>
              You corrected this.{' '}
              <button className="link" onClick={() => onDecide(undefined)}>
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
