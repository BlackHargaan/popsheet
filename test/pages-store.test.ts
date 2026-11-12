import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { clear } from 'idb-keyval'
import { getWorksheet, listScans, savePageSelection, saveScan, saveWorksheet } from '../src/store'
import type { Worksheet } from '../src/core/types'

const source: Worksheet = { id: 'WS1234', name: 'Original', createdAt: 1, pdf: new Uint8Array([1, 2]), pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], scale: .9, questions: [], extras: [] }
const next: Worksheet = { ...source, pdf: new Uint8Array([3]), pages: [source.pages[0]] }
beforeEach(() => clear())
it('saves a page selection to the existing unprinted worksheet', async () => {
  await saveWorksheet(source)
  await savePageSelection(source, next, false)
  expect(await getWorksheet(source.id)).toEqual(next)
})
it('preserves a scan that arrives before a page edit is saved', async () => {
  await saveWorksheet(source)
  await saveScan({ worksheetId: source.id, studentCode: 'AB2C', page: 1, scannedAt: 1, marks: {} })
  await expect(savePageSelection(source, next, false)).rejects.toThrow(/printed copies or scans/)
  expect(await getWorksheet(source.id)).toEqual(source)
  expect(await listScans(source.id)).toHaveLength(1)
})
it('refuses overwriting edits or printed copies made elsewhere', async () => {
  await saveWorksheet({ ...source, name: 'Edited elsewhere' })
  await expect(savePageSelection(source, next, false)).rejects.toThrow(/changed elsewhere/)
  await saveWorksheet({ ...source, printed: [{ version: 1, printedAt: 1, scale: .9, questions: [] }] })
  await expect(savePageSelection(source, next, false)).rejects.toThrow(/printed copies or scans/)
})
it('stores selected-page copies separately without changing the original or scans', async () => {
  await saveWorksheet(source)
  await saveScan({ worksheetId: source.id, studentCode: 'AB2C', page: 1, scannedAt: 1, marks: {} })
  const copy = { ...next, id: 'NEW123' }
  await savePageSelection(source, copy, true)
  expect(await getWorksheet(source.id)).toEqual(source)
  expect(await getWorksheet(copy.id)).toEqual(copy)
  expect(await listScans(source.id)).toHaveLength(1)
})
