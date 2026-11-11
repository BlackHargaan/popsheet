import { useEffect, useRef, useState } from 'react'
import { boxesOf, buildRows } from '../core/grade'
import type { BoxGrades, ClassRoom, Readings, ScanRecord, Worksheet } from '../core/types'
import { getBoxGrades, getReadings, getWorksheet, listClasses, listScans, setBoxGrade } from '../store'
import { expectedAnswers, matchesExpected } from '../core/groups'
import { isFresh } from './answerImages'
import { AnswerCrop } from './AnswerCrop'
import { GroupedAnswers } from './GroupedAnswers'
import { clearReadingError, onReading, queueReading, readingStatus } from './readingQueue'
import type { Job, ReadingStatus } from './readingQueue'
import { Back, Missing } from './icons'
import { go } from './nav'

type Mode = 'student' | 'answer'
const MODE_KEY = 'popsheet.gradeMode'
function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'student' ? 'student' : 'answer'
  } catch {
    return 'answer'
  }
}

export function Grade({ id, boxId, focusCode }: { id: string; boxId?: string; focusCode?: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [grades, setGrades] = useState<BoxGrades>({})
  const [readings, setReadings] = useState<Readings>({})
  const [mode, setModeState] = useState<Mode>(savedMode)
  const setMode = (m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // Remembering the choice is only a convenience.
    }
  }
  // Which card has the keyboard, remembered per question. Until the teacher moves, it starts on the student
  // they clicked in the results, else the first answer still to grade.
  const [picked, setPicked] = useState<{ box: string; index: number } | null>(null)
  const cardRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    void Promise.all([getWorksheet(id), listScans(id), listClasses(), getBoxGrades(id), getReadings(id)]).then(
      ([w, s, c, g, r]) => {
        setWs(w ?? null)
        setScans(s)
        setClasses(c)
        setGrades(g)
        setReadings(r)
      },
    )
  }, [id])

  // Answers are read in the background (also straight after scanning); follow along.
  const [reading, setReading] = useState<ReadingStatus | null>(() => readingStatus(id))
  useEffect(
    () =>
      onReading((wsId, st, r) => {
        if (wsId !== id) return
        setReading(st)
        if (!r) return
        setReadings(r)
        // A reading can come from a page scanned after this screen opened; pick up the new scans too.
        void listScans(id).then(setScans)
      }),
    [id],
  )

  const boxes = ws ? boxesOf(ws) : []
  const box = boxes.find((b) => b.id === boxId) ?? boxes[0]
  const unreadJobs: Job[] = ws
    ? boxes.flatMap((b) =>
        scans
          .filter((s) => s.page === b.page && s.image && !isFresh(readings[s.studentCode]?.[b.id], s, b))
          .map((s) => ({ wsId: ws.id, code: s.studentCode, page: s.page, boxId: b.id })),
      )
    : []
  const readEverything = () => {
    clearReadingError(id)
    queueReading(unreadJobs.filter((j) => j.boxId === box?.id), true)
    queueReading(unreadJobs.filter((j) => j.boxId !== box?.id))
  }
  const rows = ws ? buildRows(ws, scans, classes, grades) : []
  const students = box ? rows.filter((r) => r.pagesScanned.includes(box.page)) : []
  const record = (code: string) => scans.find((s) => s.studentCode === code && s.page === box?.page)
  const scoreOf = (code: string) => (box ? grades[code]?.[box.id] : undefined)

  const startAt = () => {
    const at = focusCode ? students.findIndex((s) => s.code === focusCode) : students.findIndex((s) => scoreOf(s.code) === undefined)
    return Math.max(0, at)
  }
  const focus = box && picked?.box === box.id ? Math.min(picked.index, Math.max(0, students.length - 1)) : startAt()
  const setFocus = (next: number | ((f: number) => number)) => {
    if (!box) return
    setPicked({ box: box.id, index: typeof next === 'function' ? next(focus) : next })
  }

  useEffect(() => {
    cardRefs.current[focus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus, box?.id])

  const grade = async (index: number, score: number | null) => {
    if (!box || !students[index]) return
    const next = await setBoxGrade(id, students[index].code, box.id, score)
    setGrades(next)
    if (score === null) return
    // Move on to the next answer that still needs a score, wrapping round once.
    for (let k = 1; k <= students.length; k++) {
      const j = (index + k) % students.length
      if (next[students[j].code]?.[box.id] === undefined) return setFocus(j)
    }
    setFocus(Math.min(index + 1, students.length - 1))
  }

  const switchBox = (delta: number) => {
    if (!box) return
    const i = boxes.indexOf(box)
    const nb = boxes[(i + delta + boxes.length) % boxes.length]
    if (nb && nb !== box) go(`/w/${id}/grade/${nb.id}`)
  }

  useEffect(() => {
    if (!box || mode !== 'student') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key) && Number(e.key) <= box.points) {
        e.preventDefault()
        void grade(focus, Number(e.key))
      } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        void grade(focus, box.points)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        void grade(focus, null)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setFocus((f) => Math.min(students.length - 1, f + 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      } else if (e.key === ']') switchBox(1)
      else if (e.key === '[') switchBox(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (ws === undefined) return null
  if (ws === null) return <Missing />

  if (!box) {
    return (
      <div className="narrow">
        <Back href={`#/w/${ws.id}/results`}>Results</Back>
        <div className="panel empty-state">
          <h2>No written answers on this worksheet</h2>
          <p>
            In the editor, switch to <b>Answer box</b> and drag around each space where students write. Then every
            student's answer to a question can be graded side by side here.
          </p>
          <a className="btn primary" href={`#/w/${ws.id}`}>
            Open the editor
          </a>
        </div>
      </div>
    )
  }

  const done = students.filter((s) => scoreOf(s.code) !== undefined).length
  const expected = expectedAnswers(box.expected)
  const unscanned = rows.length - students.length

  return (
    <div className="grade wide">
      <Back href={`#/w/${ws.id}/results`}>Results</Back>
      <div className="page-head">
        <div>
          <div className="eyebrow">Grade written answers · {ws.name}</div>
          <h1>Question {box.label}</h1>
          <p>
            Out of {box.points} point{box.points === 1 ? '' : 's'} · {done} of {students.length} graded
          </p>
        </div>
      </div>

      <nav className="box-tabs" aria-label="Written questions">
        {boxes.map((b) => {
          const have = rows.filter((r) => r.pagesScanned.includes(b.page))
          const n = have.filter((r) => grades[r.code]?.[b.id] !== undefined).length
          const complete = have.length > 0 && n === have.length
          return (
            <a key={b.id} href={`#/w/${ws.id}/grade/${b.id}`} className={'box-tab' + (b.id === box.id ? ' on' : '') + (complete ? ' done' : '')} aria-current={b.id === box.id ? 'page' : undefined}>
              <span className="lbl">Q{b.label}</span>
              <span className="cnt">
                {complete ? '✓' : `${n}/${have.length}`}
              </span>
            </a>
          )
        })}
      </nav>

      <div className="grade-bar panel">
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${students.length ? (100 * done) / students.length : 0}%` }} />
        </div>
        <div className="seg" role="group" aria-label="Grade">
          <button className={mode === 'answer' ? 'on' : ''} aria-pressed={mode === 'answer'} onClick={() => setMode('answer')}>
            By answer
          </button>
          <button className={mode === 'student' ? 'on' : ''} aria-pressed={mode === 'student'} onClick={() => setMode('student')}>
            By student
          </button>
        </div>
        <div className="keys-help">
          <span>
            <kbd>0</kbd>–<kbd>{box.points}</kbd> score
          </span>
          <span>
            <kbd>Enter</kbd> full marks
          </span>
          <span>
            <kbd>←</kbd> <kbd>→</kbd> move
          </span>
          <span>
            <kbd>[</kbd> <kbd>]</kbd> other questions
          </span>
          <span>
            <kbd>⌫</kbd> clear
          </span>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="panel empty-state">
          <h2>Nothing to grade yet</h2>
          <p>No one's page {box.page + 1} has been scanned. Scan the finished sheets and their answers will appear here.</p>
          <a className="btn primary" href="#/scan">
            Scan sheets
          </a>
        </div>
      ) : mode === 'answer' ? (
        <GroupedAnswers
          ws={ws}
          box={box}
          students={students}
          record={record}
          grades={grades}
          setGrades={setGrades}
          readings={readings}
          setReadings={setReadings}
          switchBox={switchBox}
          status={reading}
          unreadElsewhere={unreadJobs.filter((j) => j.boxId !== box.id).length}
          onRead={readEverything}
        />
      ) : (
        <ul className="answer-grid">
          {students.map((s, i) => {
            const rec = record(s.code)
            const score = scoreOf(s.code)
            const state = score === undefined ? 'todo' : score === box.points ? 'full' : score === 0 ? 'zero' : 'part'
            const reading = readings[s.code]?.[box.id]
            const match = !!rec && isFresh(reading, rec, box) && matchesExpected(reading!.text, expected)
            return (
              <li
                key={s.code}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                className={`answer-card panel ${state}` + (i === focus ? ' focus' : '')}
                onClick={() => setFocus(i)}
              >
                <div className="answer-head">
                  <span className="who">{s.name}</span>
                  {match && (
                    <span className="expected-tag" title="Reads the same as the expected answer you set">
                      Expected
                    </span>
                  )}
                  <span className="answer-score">{score === undefined ? 'Not graded' : `${score} / ${box.points}`}</span>
                </div>
                {rec && <AnswerCrop rec={rec} ws={ws} box={box} />}
                <div className="score-row" role="group" aria-label={`Score for ${s.name}`}>
                  {Array.from({ length: box.points + 1 }, (_, n) => (
                    <button
                      key={n}
                      className={'score-btn' + (score === n ? ' on' : '') + (n === box.points ? ' max' : n === 0 ? ' min' : '')}
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
              </li>
            )
          })}
        </ul>
      )}
      {unscanned > 0 && students.length > 0 && (
        <p className="muted small" style={{ marginTop: '1rem' }}>
          {unscanned} more student{unscanned === 1 ? " hasn't" : "s haven't"} had page {box.page + 1} scanned yet.
        </p>
      )}
    </div>
  )
}
