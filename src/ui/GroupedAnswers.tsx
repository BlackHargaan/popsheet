import { useEffect, useRef, useState } from 'react'
import { BLANK, expectedAnswers, groupAnswers, matchesExpected } from '../core/groups'
import type { AnswerBox, BoxGrades, Readings, ScanRecord, Worksheet } from '../core/types'
import { saveReading, setBoxGrades } from '../store'
import { boxSignature, isFresh } from './answerImages'
import { AnswerCrop } from './AnswerCrop'
import { MODEL_DOWNLOAD_MB, modelIsCached } from './reader'
import type { ReadingStatus } from './readingQueue'

interface Student {
  code: string
  name: string
}

interface Props {
  ws: Worksheet
  box: AnswerBox
  students: Student[]
  record: (code: string) => ScanRecord | undefined
  grades: BoxGrades
  setGrades: (g: BoxGrades) => void
  readings: Readings
  setReadings: (r: Readings) => void
  switchBox: (delta: number) => void
  /** Background reading of this worksheet's answers, while it runs. */
  status: ReadingStatus | null
  /** Answers on the worksheet's other questions that still need reading. */
  unreadElsewhere: number
  /** Reads every answer on the worksheet that needs it, this question first. */
  onRead: () => void
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

/**
 * Grading by answer: every student's handwriting in this box is read on this device, students who wrote the
 * same thing are put together, and one score marks the whole group. The teacher sees every crop in the group
 * and can correct any reading, which moves that student to the right group.
 */
export function GroupedAnswers({
  ws,
  box,
  students,
  record,
  grades,
  setGrades,
  readings,
  setReadings,
  switchBox,
  status,
  unreadElsewhere,
  onRead,
}: Props) {
  const [cached, setCached] = useState<boolean | null>(null)
  const [picked, setPicked] = useState<{ box: string; key: string } | null>(null)
  const cardRefs = useRef(new Map<string, HTMLLIElement | null>())

  useEffect(() => {
    void modelIsCached().then(setCached)
  }, [status?.done])

  const readable = students.filter((s) => record(s.code)?.image)
  const fresh = (code: string) => isFresh(readings[code]?.[box.id], record(code)!, box)
  const unread = readable.filter((s) => !fresh(s.code))
  const read = readable.filter((s) => fresh(s.code))
  const expected = expectedAnswers(box.expected)
  const isMatch = (g: { key: string; label: string }) => g.key !== BLANK && matchesExpected(g.label, expected)
  // Answers that match the expected answer come first: one look to confirm them, then the rest.
  const grouped = groupAnswers(read.map((s) => ({ code: s.code, text: readings[s.code][box.id].text })))
  const groups = [...grouped.filter(isMatch), ...grouped.filter((g) => !isMatch(g))]
  const nameOf = new Map(students.map((s) => [s.code, s.name]))
  const scoreOf = (code: string) => grades[code]?.[box.id]
  const groupScore = (codes: string[]) => {
    const s = new Set(codes.map(scoreOf))
    return s.size === 1 ? [...s][0] : 'mixed'
  }
  const ungraded = (codes: string[]) => codes.some((c) => scoreOf(c) === undefined)
  /** Students whose answer matches the expected one and who have no score yet. */
  const suggested = groups.filter(isMatch).flatMap((g) => g.codes.filter((c) => scoreOf(c) === undefined))

  const acceptSuggested = async () => {
    const next = await setBoxGrades(ws.id, suggested, box.id, box.points)
    setGrades(next)
    const j = groups.findIndex((g) => g.codes.some((c) => next[c]?.[box.id] === undefined))
    if (j >= 0) setFocus(j)
  }

  const firstTodo = groups.find((g) => ungraded(g.codes))?.key ?? groups[0]?.key
  const focusKey = picked?.box === box.id && groups.some((g) => g.key === picked.key) ? picked.key : firstTodo
  const focus = Math.max(
    0,
    groups.findIndex((g) => g.key === focusKey),
  )
  const setFocus = (i: number) => groups[i] && setPicked({ box: box.id, key: groups[i].key })

  useEffect(() => {
    if (focusKey !== undefined) cardRefs.current.get(focusKey)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusKey, box.id])

  const correct = async (code: string, text: string) => {
    const rec = record(code)!
    const old = readings[code]?.[box.id]
    if (old && old.text === text) return
    setReadings(await saveReading(ws.id, code, box.id, { text, auto: false, scannedAt: rec.scannedAt, box: boxSignature(box) }))
  }

  const grade = async (index: number, score: number | null) => {
    const g = groups[index]
    if (!g) return
    const next = await setBoxGrades(ws.id, g.codes, box.id, score)
    setGrades(next)
    if (score === null) return
    for (let k = 1; k <= groups.length; k++) {
      const j = (index + k) % groups.length
      if (groups[j].codes.some((c) => next[c]?.[box.id] === undefined)) return setFocus(j)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ']') return switchBox(1)
      if (e.key === '[') return switchBox(-1)
      if (!groups.length) return
      if (/^[0-9]$/.test(e.key) && Number(e.key) <= box.points) {
        e.preventDefault()
        void grade(focus, Number(e.key))
      } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        void grade(focus, box.points)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        void grade(focus, null)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault()
        setFocus(Math.min(groups.length - 1, focus + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault()
        setFocus(Math.max(0, focus - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const noImage = students.length - readable.length

  return (
    <>
      {(unread.length > 0 || status) && (
        <div className={'panel read-panel' + (read.length ? ' compact' : '')}>
          {status ? (
            <ReadProgress job={status} onRetry={onRead} />
          ) : (
            <>
              <div>
                <h2>{read.length ? `${unread.length} new answer${unread.length === 1 ? '' : 's'} to read` : 'Read and group the answers'}</h2>
                <p>
                  {read.length
                    ? 'These were scanned (or the box was moved) after the answers were last read.'
                    : 'Popsheet reads what each student wrote and puts matching answers together, so you score each different answer once.'}{' '}
                  {cached === false && (
                    <>
                      The first time, this downloads a handwriting model (about {MODEL_DOWNLOAD_MB} MB) from Hugging Face.{' '}
                    </>
                  )}
                  The answers are read on this device and never uploaded
                  {cached === false ? ', and from then on new scans are read as soon as they come in.' : '.'}
                  {unreadElsewhere > 0 && (
                    <>
                      {' '}
                      This reads the other questions too ({unreadElsewhere} more answer{unreadElsewhere === 1 ? '' : 's'}), this
                      one first.
                    </>
                  )}
                </p>
              </div>
              <button className="btn primary" onClick={onRead}>
                Read {unread.length + unreadElsewhere} answer{unread.length + unreadElsewhere === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      )}

      {groups.length > 0 && !status && suggested.length > 0 && (
        <div className="panel suggest-panel">
          <div>
            <h2>
              {suggested.length} answer{suggested.length === 1 ? ' matches' : 's match'} the expected answer
            </h2>
            <p>
              Look over the {suggested.length === 1 ? 'answer' : 'answers'} marked <b>Expected</b> below, then give{' '}
              {suggested.length === 1 ? 'it' : 'them'} full marks in one go. Fix any misreading first.
            </p>
          </div>
          <button className="btn primary" onClick={() => void acceptSuggested()}>
            Give {suggested.length} full marks
          </button>
        </div>
      )}
      {groups.length > 0 && expected.length === 0 && (
        <p className="muted small expect-tip">
          Tip: <a href={`#/w/${ws.id}`}>set an expected answer</a> for Q{box.label} in the editor, and answers that
          match it are lined up for full marks.
        </p>
      )}

      {groups.length > 0 && (
        <ul className="group-list">
          {groups.map((g, i) => {
            const score = groupScore(g.codes)
            const state = ungraded(g.codes) ? (score === 'mixed' ? 'part-done' : 'todo') : score === box.points ? 'full' : score === 0 ? 'zero' : 'part'
            const match = isMatch(g)
            return (
              <li
                key={g.key}
                ref={(el) => {
                  cardRefs.current.set(g.key, el)
                }}
                className={`group-card panel ${state}` + (i === focus ? ' focus' : '') + (match ? ' expected-match' : '')}
                onClick={() => setFocus(i)}
              >
                <div className="group-head">
                  <div className="group-answer">
                    {g.key === BLANK ? <span className="blank">Left blank</span> : <span className="said">{g.label}</span>}
                    <span className="group-count">
                      {g.codes.length} student{g.codes.length === 1 ? '' : 's'}
                    </span>
                    {match && (
                      <span className="expected-tag" title="Reads the same as the expected answer you set">
                        Expected
                      </span>
                    )}
                  </div>
                  <div className="score-row" role="group" aria-label={`Score for everyone who answered ${g.label || 'nothing'}`}>
                    {Array.from({ length: box.points + 1 }, (_, n) => (
                      <button
                        key={n}
                        className={
                          'score-btn' +
                          (score === n ? ' on' : '') +
                          (n === box.points ? ' max' : n === 0 ? ' min' : '') +
                          (match && n === box.points && score === undefined ? ' suggest' : '')
                        }
                        aria-pressed={score === n}
                        onClick={(e) => {
                          e.stopPropagation()
                          setFocus(i)
                          void grade(i, n)
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {score === 'mixed' && <p className="group-note">These students have different scores. A score here gives them all the same one.</p>}
                <ul className="members">
                  {g.codes.map((code) => {
                    const s = scoreOf(code)
                    return (
                      <li key={code} className="member">
                        <AnswerCrop rec={record(code)!} ws={ws} box={box} />
                        <div className="member-foot">
                          <span className="who">{nameOf.get(code)}</span>
                          {score === 'mixed' && <span className="answer-score">{s === undefined ? '–' : s}</span>}
                        </div>
                        <ReadingInput
                          value={readings[code][box.id].text}
                          corrected={!readings[code][box.id].auto}
                          onCommit={(t) => void correct(code, t)}
                        />
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      {noImage > 0 && (
        <p className="muted small" style={{ marginTop: '1rem' }}>
          {noImage} student{noImage === 1 ? ' was' : 's were'} scanned before answer boxes existed, so{' '}
          {noImage === 1 ? 'their answer' : 'their answers'} can't be read. Scan those pages again, or grade by student.
        </p>
      )}
    </>
  )
}

function ReadProgress({ job, onRetry }: { job: ReadingStatus; onRetry: () => void }) {
  const d = job.download
  const downloading = d && d.total > 0 && d.loaded < d.total
  const share = downloading ? d.loaded / d.total : job.total ? job.done / job.total : 0
  return (
    <div className="read-progress">
      <div>
        <h2>{job.error ? 'Reading stopped' : downloading ? 'Downloading the handwriting model' : 'Reading answers'}</h2>
        <p>
          {job.error
            ? `${job.error} The answers read so far are saved.`
            : downloading
              ? `${mb(d.loaded)} of ${mb(d.total)}. Only needed once; after this, reading works offline.`
              : `${job.done} of ${job.total} read, on this device. You can start grading the ones already read.`}
        </p>
        {!job.error && (
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${Math.round(100 * share)}%` }} />
          </div>
        )}
      </div>
      {job.error && (
        <button className="btn primary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** The text read from one answer, editable so a misreading can be put right (which regroups the answer). */
function ReadingInput({ value, corrected, onCommit }: { value: string; corrected: boolean; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className={'reading' + (corrected ? ' corrected' : '')}
      value={draft ?? value}
      placeholder="(blank)"
      aria-label="What this student wrote"
      title={corrected ? 'Corrected by you' : 'Read automatically. Fix it if it was misread.'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft.trim())
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
    />
  )
}
