import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clear, entries, set } from 'idb-keyval'
import { exportBackup, restoreBackup } from '../src/store'
import { parseBackup } from '../src/core/backup'

beforeEach(() => clear())
describe('backup storage transactions', () => {
  it('restores a bundle and skips conflicts without mixing scan data', async () => {
    await set('ws:A', { name: 'Current' })
    await set('scan:A:S:0', { old: true })
    const incoming: [string, unknown][] = [['ws:A', { name: 'Backup' }], ['grades:A', { restored: true }], ['class:C', { name: 'New class' }]]
    expect(await restoreBackup(incoming, false)).toBe(1)
    expect(Object.fromEntries(await entries())).toEqual({ 'ws:A': { name: 'Current' }, 'scan:A:S:0': { old: true }, 'class:C': { name: 'New class' } })
    expect(await restoreBackup(incoming, true)).toBe(3)
    expect(Object.fromEntries(await entries())).toEqual({ 'ws:A': { name: 'Backup' }, 'grades:A': { restored: true }, 'class:C': { name: 'New class' } })
  })
  it('leaves all records untouched if the restore plan is invalid', async () => {
    await set('ws:A', { name: 'Current' })
    await expect(restoreBackup([['ws:A', {}], ['grades:B', {}]], true)).rejects.toThrow()
    expect(await entries()).toEqual([['ws:A', { name: 'Current' }]])
  })
  it('rolls back deletes and earlier writes when any record cannot be stored', async () => {
    await set('ws:A', { name: 'Current' })
    await set('scan:A:S:0', { old: true })
    await expect(restoreBackup([['ws:A', { name: 'New' }], ['grades:A', () => {}]], true)).rejects.toThrow()
    expect(Object.fromEntries(await entries())).toEqual({ 'ws:A': { name: 'Current' }, 'scan:A:S:0': { old: true } })
  })
  it('exports only app data and preserves binary files', async () => {
    const worksheet = { id: 'A', name: 'A', createdAt: 1, pdf: new Uint8Array([1]), pages: [{ width: 612, height: 792 }], scale: 1, questions: [], extras: [] }
    await set('ws:A', worksheet); await set('unrelated-cache', 'ignore')
    const backup = parseBackup(await exportBackup())
    expect(backup).toEqual([['ws:A', worksheet]])
  })
})
