import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listScans } from '../store'
import { go, useRoute } from '../ui/nav'
import {
  closeDemoTour,
  demoRecords,
  demoState,
  onDemoChange,
  removeDemoData,
  seedDemoReadings,
  sendToScanner,
  setDemoStep,
  startDemo,
} from './demo'
import type { DemoState } from './demo'
import { makeDemoPhotos } from './demoSheets'
import type { DemoPhoto } from './demoSheets'

interface Ids {
  ws: string
  cls: string
}

interface Step {
  path: (ids: Ids) => string
  /** What to point at: a CSS selector, or a function for things a selector can't name. */
  target?: string | ((ids: Ids) => Element | null)
  title: string
  body: ReactNode
  /** Runs when the step opens. */
  enter?: (ids: Ids) => void | Promise<void>
  scan?: boolean
  finish?: boolean
}

const byText = (selector: string, text: string) => () =>
  [...document.querySelectorAll(selector)].find((e) => e.textContent?.includes(text)) ?? null

const STEPS: Step[] = [
  {
    path: () => '/',
    target: (ids) => document.querySelector(`a.sheet-title[href="#/w/${ids.ws}"]`)?.closest('.sheet') ?? null,
    title: 'Welcome to Popsheet',
    body: (
      <>
        <p>
          This tour runs a whole quiz through Popsheet: a worksheet, a class of eight made-up students, their filled-in
          sheets, and the scores.
        </p>
        <p>
          The demo quiz is now in your library. It's a normal worksheet, so you can poke at anything along the way.
          Nothing leaves this device.
        </p>
      </>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}`,
    target: '.desk',
    title: 'Your worksheet, as it is',
    body: (
      <p>
        Teachers upload the worksheet they already use, as a PDF. Popsheet shrinks the page a touch and adds corner
        squares and a page code, so the scanner can line up any photo of it.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}`,
    target: '.seg.tools',
    title: 'Three kinds of answers',
    body: (
      <ul>
        <li>
          <b>Bubbles</b> for multiple choice (questions 1–8).
        </li>
        <li>
          <b>Number grids</b>: students write a number and bubble each digit (question 9).
        </li>
        <li>
          <b>Written answers</b>: draw a box around an answer space that's already on the page (questions 10 and 11).
        </li>
      </ul>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}`,
    target: '.side.panel',
    title: 'The answer key',
    body: (
      <p>
        Click a bubble to mark the right answer, set points, type the number for a grid, and add the expected answer
        for written questions. Changing the key later simply re-scores every sheet.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}`,
    target: '.page-code',
    title: 'Editing tools',
    body: (
      <p>
        Everything can be dragged, including the page code. There's undo and redo, multi-select with alignment and
        snapping, <b>Duplicate selection</b> for repeating a row of bubbles down the page, and <b>Manage PDF pages</b>{' '}
        for multi-page worksheets.
      </p>
    ),
  },
  {
    path: () => '/classes',
    target: byText('.class-card', 'Demo class'),
    title: 'Classes and student codes',
    body: (
      <p>
        Paste a list of names and every student gets a short code. Students keep their code if the list changes, so
        old printouts still scan.
      </p>
    ),
  },
  {
    path: () => '/classes',
    target: '.privacy',
    title: 'Names stay on this device',
    body: (
      <p>
        A printed sheet carries only its code. The list that links codes to names never leaves this browser, so a
        lost or photographed sheet doesn't give away who it belongs to.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}/print`,
    target: '.layout-check',
    title: 'Checked before printing',
    body: (
      <p>
        Popsheet checks for bubbles that overlap, a page code sitting on top of the worksheet's own ink, and anything
        too close to the edges or corner squares.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}/print`,
    target: '.print-preview',
    title: 'A true preview',
    body: <p>The preview comes from the same code that makes the PDF, so what you see is what prints.</p>,
  },
  {
    path: (ids) => `/w/${ids.ws}/print`,
    target: '.panel.summary',
    title: 'One coded copy per student',
    body: (
      <p>
        Download gives one PDF with a named, coded copy for every student, plus spares. Each print is recorded as a
        version, so moving a bubble later never breaks sheets already handed out. The demo class's sheets are already
        printed.
      </p>
    ),
  },
  {
    path: () => '/scan',
    // The drop zone, then the list of read sheets once there is one.
    target: () => document.querySelector('.scan-list') ?? document.querySelector('.drop'),
    title: 'Scan the finished sheets',
    body: null,
    scan: true,
  },
  {
    path: (ids) => `/w/${ids.ws}/results`,
    target: '.stats',
    title: 'Scores straight away',
    body: <p>Every sheet is scored as soon as it's read, including the number grids.</p>,
    enter: () => seedDemoReadings(),
  },
  {
    path: (ids) => `/w/${ids.ws}/results`,
    target: '.table-wrap',
    title: 'Every answer, at a glance',
    body: (
      <p>
        Green is right, red is wrong. Yellow cells are marks the scanner wasn't sure about: here Jordan filled in two
        bubbles for question 3. Click any cell to see the student's actual mark and correct it.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}/results`,
    target: '.review-queue',
    title: 'Check the doubtful ones in one pass',
    body: (
      <p>
        The review queue steps through every flagged answer with a picture of the mark. Press a letter to decide, or
        skip it for now. Try <b>Review</b> if you like.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}/results`,
    target: '.table-wrap tfoot',
    title: 'What to reteach',
    body: (
      <p>
        Per-question stats show which questions the class missed and the most common wrong answer. On question 5,
        most picked A (480): they multiplied instead of dividing.
      </p>
    ),
  },
  {
    path: (ids) => `/w/${ids.ws}/grade`,
    target: '.group-list',
    title: 'Written answers, grouped',
    body: (
      <>
        <p>
          Written answers are cut out of each scan and matching answers are grouped, so you score a group with one
          click. Answers that match the expected answer are marked.
        </p>
        <p className="tour-note">
          On real sheets the handwriting is read on this device after a one-time download. For the demo, the reading
          has been filled in for you.
        </p>
      </>
    ),
    enter: async () => {
      await seedDemoReadings()
      try {
        localStorage.setItem('popsheet.gradeMode', 'answer')
      } catch {
        // Only a preference.
      }
    },
  },
  {
    path: (ids) => `/w/${ids.ws}/results`,
    target: byText('.results .page-head button', 'Export CSV'),
    title: 'Into your gradebook',
    body: (
      <p>
        Export a spreadsheet of scores and every answer. <b>Download backup</b> on the Worksheets screen saves
        everything to a file, and Popsheet can be installed to work offline.
      </p>
    ),
  },
  {
    path: () => '/',
    title: "That's Popsheet",
    body: (
      <p>
        Upload a worksheet of your own to get started. You can keep the demo quiz and class to explore, or remove
        them now.
      </p>
    ),
    finish: true,
  },
]

/** True when the element, or something it sits in, stays put while the page scrolls. */
function pinned(el: Element) {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    if (getComputedStyle(e).position === 'fixed') return true
  }
  return false
}

/**
 * Keeps a highlight ring on the target. The ring is placed in page coordinates, so the browser scrolls it
 * together with the page and it never trails behind; each frame only corrects for layout changes (and for
 * sticky parts of the page). `key` names the target: a new key looks afresh, scrolls the target into view and
 * slides the ring over. Returns the ring's ref and the target's on-screen box once scrolling settles, which is
 * what the tour card uses to stay out of the way.
 */
function useSpotlight(key: string, find: (() => Element | null) | null) {
  const ring = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState<{ key: string; rect: DOMRect } | null>(null)
  const findRef = useRef(find)
  useEffect(() => {
    findRef.current = find
  })
  useEffect(() => {
    const node = ring.current
    if (!node) return
    let frame = 0
    let last = ''
    let lastView = ''
    let scrolled = false
    let target: Element | null = null
    let fixed = false
    let timer = 0
    let settledOnce = false
    node.classList.add('moving')
    const stopMoving = setTimeout(() => node.classList.remove('moving'), 350)
    const tick = () => {
      const el = findRef.current?.() ?? null
      if (el !== target) {
        target = el
        fixed = !!el && pinned(el)
      }
      const r = el?.getBoundingClientRect() ?? null
      const show = !!el && !!r && r.width > 0
      if (show && !scrolled) {
        scrolled = true
        el.scrollIntoView({
          block: r.height > innerHeight * 0.7 ? 'start' : 'center',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        })
      }
      const dx = fixed ? 0 : scrollX
      const dy = fixed ? 0 : scrollY
      const sig = show ? `${fixed}|${r.left + dx}|${r.top + dy}|${r.width}|${r.height}` : ''
      if (sig !== last) {
        last = sig
        if (show) {
          node.style.display = 'block'
          node.style.position = fixed ? 'fixed' : 'absolute'
          node.style.left = `${r.left + dx - 6}px`
          node.style.top = `${r.top + dy - 6}px`
          node.style.width = `${r.width + 12}px`
          node.style.height = `${r.height + 12}px`
        } else node.style.display = 'none'
      }
      // The card only needs to know once the page stops moving.
      const view = show ? `${r.left}|${r.top}|${r.width}|${r.height}` : ''
      if (view !== lastView) {
        lastView = view
        clearTimeout(timer)
        timer = window.setTimeout(() => setSettled(show ? { key, rect: r } : null), lastView && settledOnce ? 150 : 0)
        settledOnce = true
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(stopMoving)
    }
  }, [key])
  return { ring, rect: settled && settled.key === key && find ? settled.rect : null }
}

let photos: { ws: string; list: DemoPhoto[] } | null = null

function ScanStep({ ids }: { ids: Ids }) {
  const [made, setMade] = useState(photos?.ws === ids.ws ? photos.list : null)
  const [progress, setProgress] = useState(0)
  const [read, setRead] = useState<number | null>(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const total = 8

  useEffect(() => {
    let live = true
    const poll = async () => {
      const n = (await listScans(ids.ws)).length
      if (live) setRead(n)
    }
    void poll()
    const t = setInterval(() => void poll(), 600)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [ids.ws])

  useEffect(() => {
    if (made || read === null || read >= total) return
    let live = true
    void (async () => {
      const rec = await demoRecords()
      if (!rec) return
      try {
        const p = await makeDemoPhotos(rec.ws, rec.cls, (n) => live && setProgress(n))
        photos = { ws: ids.ws, list: p }
        if (live) setMade(p)
      } catch {
        if (live) setError('The demo photos could not be made in this browser.')
      }
    })()
    return () => {
      live = false
    }
  }, [made, read, ids.ws])

  useEffect(() => {
    if (read !== null && read >= total) void seedDemoReadings()
  }, [read])

  if (read !== null && read >= total) {
    return <p>All {total} sheets are read. Next, the results.</p>
  }
  return (
    <>
      <p>
        Here are phone photos of the class's finished sheets: tilted, unevenly lit, one upside down, a double mark and
        an erasure. They go through the same scanner your own photos would.
      </p>
      {error && <p className="error">{error}</p>}
      {!made && !error && (
        <p className="muted small" role="status">
          Filling in sheets… {progress} of {total}
        </p>
      )}
      {made && (
        <div className="tour-photos">
          {made.map((p) => (
            <img key={p.name} src={p.thumb} alt={`Photo of ${p.name}'s sheet`} />
          ))}
        </div>
      )}
      {made && !sent && (
        <button
          className="hi"
          onClick={() => {
            setSent(true)
            sendToScanner(made.map((p) => p.file))
          }}
        >
          Scan these {made.length} photos
        </button>
      )}
      {sent && (
        <p className="muted small" role="status">
          Read {read ?? 0} of {total}…
        </p>
      )}
    </>
  )
}

/** Places the tour card where it won't cover what it's pointing at. */
function placeCard(card: DOMRect, target: DOMRect | null) {
  const m = 16
  const top = 76
  const spots = [
    { left: innerWidth - card.width - m, top: innerHeight - card.height - m },
    { left: m, top: innerHeight - card.height - m },
    { left: innerWidth - card.width - m, top },
    { left: m, top },
  ]
  if (!target) return spots[0]
  const overlap = (s: { left: number; top: number }) => {
    const x = Math.max(0, Math.min(s.left + card.width, target.right) - Math.max(s.left, target.left))
    const y = Math.max(0, Math.min(s.top + card.height, target.bottom) - Math.max(s.top, target.top))
    return x * y
  }
  return spots.reduce((best, s) => (overlap(s) < overlap(best) ? s : best))
}

export function DemoTour() {
  const [state, setState] = useState<DemoState | null>(demoState)
  const route = useRoute()
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => onDemoChange(setState), [])

  const step = state ? STEPS[Math.min(state.step, STEPS.length - 1)] : null
  const ids: Ids | null = state ? { ws: state.wsId, cls: state.classId } : null
  const path = step && ids ? step.path(ids) : ''
  const here = '/' + route.join('/') === path

  // Opening a step takes the page there.
  const stepIndex = state?.active ? state.step : -1
  useEffect(() => {
    if (stepIndex < 0 || !ids) return
    const s = STEPS[stepIndex]
    void (async () => {
      await s.enter?.(ids)
      go(s.path(ids))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])

  // If the demo's worksheet or class was deleted, the tour can't go on.
  useEffect(() => {
    if (!state?.active) return
    void demoRecords(state).then((r) => {
      if (!r) closeDemoTour()
    })
  }, [state, route])

  const t = step?.target
  const find = !here || !t || !ids ? null : typeof t === 'string' ? () => document.querySelector(t) : () => t(ids)
  const { ring, rect } = useSpotlight(`${stepIndex}|${here}`, find)

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const place = () => setPos(innerWidth < 640 ? null : placeCard(card.getBoundingClientRect(), rect))
    place()
    // The card changes size as a step's content loads (the scan step's photos), so place it again.
    const watch = new ResizeObserver(place)
    watch.observe(card)
    addEventListener('resize', place)
    return () => {
      watch.disconnect()
      removeEventListener('resize', place)
    }
  }, [rect, stepIndex])

  if (!state?.active || !step || !ids) return null
  const n = STEPS.length
  const to = (i: number) => setDemoStep(Math.max(0, Math.min(n - 1, i)))

  const finish = async (remove: boolean) => {
    setBusy(true)
    if (remove) await removeDemoData()
    else closeDemoTour()
    setBusy(false)
    go('/')
  }

  return (
    <>
      {createPortal(<div ref={ring} className="tour-ring" aria-hidden="true" />, document.body)}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-label="Popsheet demo"
        style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
      >
        <div className="tour-top">
          <span className="eyebrow">
            Demo · {state.step + 1} of {n}
          </span>
          <button className="ghost sm" aria-label="Close the demo" title="Close the demo" onClick={() => closeDemoTour()}>
            ✕
          </button>
        </div>
        <div className="tour-bar" aria-hidden="true">
          <i style={{ width: `${(100 * (state.step + 1)) / n}%` }} />
        </div>
        <h2>{step.title}</h2>
        <div className="tour-body">{step.scan ? <ScanStep key={ids.ws} ids={ids} /> : step.body}</div>
        {!here && (
          <p className="small">
            <button className="link" onClick={() => go(path)}>
              Back to this step
            </button>
          </p>
        )}
        {step.finish ? (
          <div className="tour-actions">
            <button disabled={busy} onClick={() => void finish(true)}>
              Remove demo data
            </button>
            <button className="primary" disabled={busy} onClick={() => void finish(false)}>
              Keep it and explore
            </button>
            <button className="link" disabled={busy} onClick={() => void startDemo()}>
              Start over
            </button>
          </div>
        ) : (
          <div className="tour-actions">
            <button disabled={state.step === 0} onClick={() => to(state.step - 1)}>
              Back
            </button>
            <button className="primary" onClick={() => to(state.step + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </>
  )
}
