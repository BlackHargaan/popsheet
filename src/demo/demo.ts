import { BLANK } from '../core/groups'
import type { ClassRoom, Worksheet } from '../core/types'
import { versionForPrint } from '../core/versions'
import {
  deleteClass,
  deleteWorksheet,
  getReadings,
  getWorksheet,
  listClasses,
  listScans,
  saveClass,
  saveReading,
  saveWorksheet,
  takenCodes,
} from '../store'
import { boxSignature, isFresh } from '../ui/answerImages'
import { STUDENTS, makeDemo } from './demoData'

/**
 * Keeps track of the guided demo: which worksheet and class it made, and which step the tour is on, so a
 * reload carries on where it left off. Only these ids and the step are kept in browser storage; the demo's
 * worksheet, class and scans are ordinary Popsheet records and can be deleted like any other.
 */

export interface DemoState {
  wsId: string
  classId: string
  step: number
  /** False once the tour is closed; the demo data can stay behind. */
  active: boolean
}

const KEY = 'popsheet.demo'
let listeners: ((s: DemoState | null) => void)[] = []

export function demoState(): DemoState | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DemoState) : null
  } catch {
    return null
  }
}

function setState(s: DemoState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the tour still works; it just won't survive a reload.
  }
  for (const l of listeners) l(s)
}

export function onDemoChange(cb: (s: DemoState | null) => void) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export const setDemoStep = (step: number) => {
  const s = demoState()
  if (s) setState({ ...s, step })
}

export const closeDemoTour = () => {
  const s = demoState()
  if (s) setState({ ...s, active: false })
}

/** The demo's worksheet and class, if they are still on this device. */
export async function demoRecords(s = demoState()): Promise<{ ws: Worksheet; cls: ClassRoom } | null> {
  if (!s) return null
  const ws = await getWorksheet(s.wsId)
  const cls = (await listClasses()).find((c) => c.id === s.classId)
  return ws && cls ? { ws, cls } : null
}

/**
 * Starts the tour from the beginning. The demo worksheet and class are made fresh each time (an earlier demo's
 * are removed first), already printed once, so the sheets the tour scans match a real printed version.
 */
export async function startDemo() {
  await removeDemoData()
  const { worksheet, classroom } = await makeDemo(await takenCodes())
  const { ws } = versionForPrint(worksheet)
  await saveClass(classroom)
  await saveWorksheet(ws)
  setState({ wsId: ws.id, classId: classroom.id, step: 0, active: true })
}

/** Deletes the demo's worksheet (with its scans and grades) and its class. */
export async function removeDemoData() {
  const s = demoState()
  if (s) {
    await deleteWorksheet(s.wsId)
    await deleteClass(s.classId)
  }
  setState(null)
}

/**
 * Fills in what each demo student wrote in the written-answer boxes, as if the handwriting reader had read
 * it, so the grading screen can group matching answers without the one-time model download. The scanned
 * images, scores and everything else are real.
 */
export async function seedDemoReadings() {
  const rec = await demoRecords()
  if (!rec) return
  const { ws, cls } = rec
  const scans = await listScans(ws.id)
  const readings = await getReadings(ws.id)
  for (const scan of scans) {
    const student = cls.students.find((s) => s.code === scan.studentCode)
    const work = STUDENTS.find((w) => w.name === student?.name)
    if (!work) continue
    for (const [i, box] of (ws.boxes ?? []).entries()) {
      if (box.page !== scan.page || isFresh(readings[scan.studentCode]?.[box.id], scan, box)) continue
      await saveReading(ws.id, scan.studentCode, box.id, {
        text: work.written[i] || BLANK,
        auto: true,
        scannedAt: scan.scannedAt,
        box: boxSignature(box),
      })
    }
  }
}

// ---- Handing the demo photos to the Scan screen ----

let pending: File[] | null = null
let receiver: ((files: File[]) => void) | null = null

/** Gives photos to the Scan screen, now if it is open or as soon as it opens. */
export function sendToScanner(files: File[]) {
  if (receiver) receiver(files)
  else pending = files
}

/** Called by the Scan screen: receives demo photos. Returns an unsubscribe function. */
export function receiveDemoPhotos(cb: (files: File[]) => void) {
  receiver = cb
  if (pending) {
    const files = pending
    pending = null
    cb(files)
  }
  return () => {
    if (receiver === cb) receiver = null
  }
}
