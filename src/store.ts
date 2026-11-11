import { del, entries, get, set, update } from 'idb-keyval'
import type { BoxGrades, ClassRoom, Reading, Readings, ScanRecord, Worksheet } from './core/types'

// Everything lives in this browser's own storage (IndexedDB). Nothing is sent anywhere.

async function list<T>(prefix: string): Promise<T[]> {
  const all = await entries<string, T>()
  return all.filter(([k]) => typeof k === 'string' && k.startsWith(prefix)).map(([, v]) => v)
}

export const listWorksheets = async () =>
  (await list<Worksheet>('ws:')).sort((a, b) => b.createdAt - a.createdAt)
export const getWorksheet = (id: string) => get<Worksheet>(`ws:${id}`)
export const saveWorksheet = (ws: Worksheet) => set(`ws:${ws.id}`, ws)

export async function deleteWorksheet(id: string) {
  const all = await entries<string, unknown>()
  await Promise.all(
    all
      .filter(
        ([k]) =>
          k === `ws:${id}` || k === `grades:${id}` || k === `readings:${id}` || String(k).startsWith(`scan:${id}:`),
      )
      .map(([k]) => del(k)),
  )
}

export const listClasses = async () =>
  (await list<ClassRoom>('class:')).sort((a, b) => a.name.localeCompare(b.name))
export const saveClass = (c: ClassRoom) => set(`class:${c.id}`, c)
export const deleteClass = (id: string) => del(`class:${id}`)

const scanKey = (s: Pick<ScanRecord, 'worksheetId' | 'studentCode' | 'page'>) =>
  `scan:${s.worksheetId}:${s.studentCode}:${s.page}`
export const listScans = (worksheetId: string) => list<ScanRecord>(`scan:${worksheetId}:`)
export const saveScan = (s: ScanRecord) => set(scanKey(s), s)
export const getScan = (worksheetId: string, studentCode: string, page: number) =>
  get<ScanRecord>(scanKey({ worksheetId, studentCode, page }))
export async function deleteStudentScans(worksheetId: string, studentCode: string) {
  const all = await entries<string, unknown>()
  await Promise.all(
    all.filter(([k]) => String(k).startsWith(`scan:${worksheetId}:${studentCode}:`)).map(([k]) => del(k)),
  )
  await update<BoxGrades>(`grades:${worksheetId}`, (g = {}) => {
    const rest = { ...g }
    delete rest[studentCode]
    return rest
  })
  await update<Readings>(`readings:${worksheetId}`, (r = {}) => {
    const rest = { ...r }
    delete rest[studentCode]
    return rest
  })
}

// Teacher scores for written answers. Kept apart from scans so rescanning a page never loses them.
export const getBoxGrades = async (worksheetId: string) => (await get<BoxGrades>(`grades:${worksheetId}`)) ?? {}

/** Sets (or, with null, clears) one student's score on one answer box. Returns the updated grades. */
export async function setBoxGrade(worksheetId: string, studentCode: string, boxId: string, score: number | null) {
  let result: BoxGrades = {}
  await update<BoxGrades>(`grades:${worksheetId}`, (g = {}) => {
    const mine = { ...g[studentCode] }
    if (score === null) delete mine[boxId]
    else mine[boxId] = score
    result = { ...g, [studentCode]: mine }
    return result
  })
  return result
}

/** Gives several students the same score on one answer box at once (grading a whole group of answers). */
export async function setBoxGrades(worksheetId: string, studentCodes: string[], boxId: string, score: number | null) {
  let result: BoxGrades = {}
  await update<BoxGrades>(`grades:${worksheetId}`, (g = {}) => {
    result = { ...g }
    for (const code of studentCodes) {
      const mine = { ...result[code] }
      if (score === null) delete mine[boxId]
      else mine[boxId] = score
      result[code] = mine
    }
    return result
  })
  return result
}

// What students wrote in each answer box, read on this device so identical answers can be graded together.
export const getReadings = async (worksheetId: string) => (await get<Readings>(`readings:${worksheetId}`)) ?? {}

export async function saveReading(worksheetId: string, studentCode: string, boxId: string, reading: Reading) {
  let result: Readings = {}
  await update<Readings>(`readings:${worksheetId}`, (r = {}) => {
    result = { ...r, [studentCode]: { ...r[studentCode], [boxId]: reading } }
    return result
  })
  return result
}

/** Every student / spare code already in use, so new ones never clash. */
export async function takenCodes(): Promise<Set<string>> {
  const taken = new Set<string>()
  for (const c of await listClasses()) for (const s of c.students) taken.add(s.code)
  for (const w of await listWorksheets()) for (const e of w.extras) taken.add(e)
  return taken
}
