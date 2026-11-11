import { BLANK } from '../core/groups'
import type { Readings } from '../core/types'
import { getReadings, getScan, getWorksheet, saveReading } from '../store'
import { answerImage, boxSignature, isFresh } from './answerImages'
import { onDownloadProgress, readHandwriting } from './reader'
import type { DownloadProgress } from './reader'

/**
 * Reads written answers in the background, one at a time, for as long as Popsheet is open: every answer box
 * on a worksheet when the teacher asks, and each new scan's boxes as it comes in (once the handwriting model
 * is on the device). Readings are saved as they come, so nothing is lost if the page is closed half way.
 *
 * Jobs name a student's page and a box rather than holding the scan, so a rescan or a moved box that lands
 * while a job waits is read as it is when its turn comes, and an answer that is already up to date is skipped.
 */

export interface Job {
  wsId: string
  code: string
  page: number
  boxId: string
}

export interface ReadingStatus {
  /** Answers queued for this worksheet since the queue last emptied, and how many are finished. */
  total: number
  done: number
  download: DownloadProgress | null
  error?: string
}

type Listener = (wsId: string, status: ReadingStatus | null, readings: Readings | null) => void

const queue: Job[] = []
const keys = new Set<string>()
const status = new Map<string, ReadingStatus>()
let listeners: Listener[] = []
let running = false

const keyOf = (j: Job) => `${j.wsId}|${j.code}|${j.page}|${j.boxId}`
const emit = (wsId: string, readings: Readings | null = null) => {
  for (const l of listeners) l(wsId, status.get(wsId) ?? null, readings)
}

/** Follows reading progress and new readings. Returns an unsubscribe function. */
export function onReading(cb: Listener) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export const readingStatus = (wsId: string) => status.get(wsId) ?? null

/** Answers still waiting to be read, across every worksheet. */
export const answersLeftToRead = () => queue.length

/** Adds answers to read. `first` puts them ahead of anything already waiting (the question on screen). */
export function queueReading(jobs: Job[], first = false) {
  const fresh = jobs.filter((j) => !keys.has(keyOf(j)))
  if (!fresh.length) return
  for (const j of fresh) keys.add(keyOf(j))
  if (first) queue.unshift(...fresh)
  else queue.push(...fresh)
  for (const wsId of new Set(fresh.map((j) => j.wsId))) {
    const s = status.get(wsId)
    const added = fresh.filter((j) => j.wsId === wsId).length
    status.set(wsId, s && !s.error ? { ...s, total: s.total + added } : { total: added, done: 0, download: null })
    emit(wsId)
  }
  void run()
}

/** Every answer box on the given pages: the jobs for one or more scanned pages. */
export async function jobsForPages(wsId: string, pages: { code: string; page: number }[]): Promise<Job[]> {
  const ws = await getWorksheet(wsId)
  if (!ws) return []
  const boxes = ws.boxes ?? []
  return pages.flatMap(({ code, page }) =>
    boxes.filter((b) => b.page === page).map((b) => ({ wsId, code, page, boxId: b.id })),
  )
}

async function run() {
  if (running) return
  running = true
  const stopDownload = onDownloadProgress((p) => {
    const j = queue[0]
    const s = j && status.get(j.wsId)
    if (s) {
      s.download = p
      emit(j.wsId)
    }
  })
  try {
    while (queue.length) {
      const job = queue[0]
      let readings: Readings | null
      try {
        readings = await readOne(job)
      } catch (err) {
        // Stop this worksheet's reading (the model may have failed to download); the rest can be retried.
        const message = err instanceof Error ? err.message : String(err)
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].wsId === job.wsId) keys.delete(keyOf(queue.splice(i, 1)[0]))
        }
        status.set(job.wsId, { ...(status.get(job.wsId) ?? { total: 0, done: 0, download: null }), error: message })
        emit(job.wsId)
        continue
      }
      queue.shift()
      keys.delete(keyOf(job))
      const s = status.get(job.wsId)
      if (s) s.done++
      // Done with this worksheet: clear its progress (the readings still go out with this last update).
      if (!queue.some((j) => j.wsId === job.wsId)) status.delete(job.wsId)
      emit(job.wsId, readings)
    }
  } finally {
    stopDownload()
    running = false
  }
}

/** Reads one answer if its reading is missing or out of date. Returns the worksheet's readings if it changed. */
async function readOne(job: Job): Promise<Readings | null> {
  const [ws, rec, readings] = await Promise.all([getWorksheet(job.wsId), getScan(job.wsId, job.code, job.page), getReadings(job.wsId)])
  const box = ws?.boxes?.find((b) => b.id === job.boxId)
  if (!ws || !box || !rec?.image || !rec.ppp || box.page !== rec.page) return null
  if (isFresh(readings[job.code]?.[box.id], rec, box)) return null
  const image = await answerImage(ws, rec, box)
  const text = image ? await readHandwriting(image) : BLANK
  return saveReading(ws.id, job.code, box.id, { text, auto: true, scannedAt: rec.scannedAt, box: boxSignature(box) })
}

/** Forgets a worksheet's error so its answers can be queued again. */
export function clearReadingError(wsId: string) {
  if (status.get(wsId)?.error) {
    status.delete(wsId)
    emit(wsId)
  }
}
