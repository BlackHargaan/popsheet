import { describe, expect, it } from 'vitest'
import { encodeBackup, parseBackup, planRestore } from '../src/core/backup'
import type { BackupEntry } from '../src/core/backup'
import { editorItems, moveItems, snapItems } from '../src/core/editing'
import type { Worksheet } from '../src/core/types'

const ws: Worksheet = { id: 'ABC123', name: 'Test', createdAt: 1, pdf: new Uint8Array([37, 80, 68, 70]), pages: [{ width: 612, height: 792 }], scale: 0.9, extras: [], questions: [
  { id: 'Q1', page: 0, x: 100, y: 100, choices: 4, dir: 'h', answer: 0, points: 1 },
  { id: 'Q2', page: 0, x: 200, y: 200, choices: 4, dir: 'h', answer: 1, points: 1 },
], boxes: [{ id: 'B1', page: 0, x: 100, y: 300, width: 80, height: 40, label: '3', points: 2 }] }

describe('editor geometry', () => {
  it('moves mixed selections in printed points without changing their spacing', () => {
    const next = moveItems(ws, 0, ['Q1', 'B1'], 18, 9)
    expect(next.questions[0].x).toBe(118)
    expect(next.questions[1]).toBe(ws.questions[1])
    expect(next.boxes![0].x).toBe(120)
    expect(next.boxes![0].y).toBe(310)
    expect(ws.questions[0].x).toBe(100)
  })
  it('clamps the whole selection together at page edges', () => {
    const next = moveItems(ws, 0, ['Q1', 'Q2'], -1000, 0)
    expect(next.questions[1].x - next.questions[0].x).toBe(100)
    expect(editorItems(next, 0)[0].x).toBe(22)
  })
  it('snaps near alignment but leaves distant movement unchanged', () => {
    const snap = snapItems(ws, 0, ['Q1'], 98, 20)
    expect(snap.dx).toBe(100)
    expect(snap.x).toBeDefined()
    expect(snap.dy).toBe(20)
    expect(snapItems(ws, 0, ['Q1', 'Q2', 'B1'], 7, 7)).toMatchObject({ dx: 7, dy: 7, x: undefined, y: undefined })
  })
  it('does not move selected items on other pages', () => {
    const next = moveItems({ ...ws, pages: [...ws.pages, ...ws.pages], questions: ws.questions.map(q => ({ ...q, page: 1 })) }, 0, ['Q1'], 10, 10)
    expect(next.questions[0].x).toBe(100)
  })
})

describe('portable backups', () => {
  it('round-trips PDFs, scans, crops, classes, printed versions, grades and readings', async () => {
    const entries: BackupEntry[] = [
      ['ws:ABC123', { ...ws, pageCodes: [{ x: 100, y: 650 }], printed: [{ version: 1, printedAt: 1, scale: .9, questions: ws.questions }] }],
      ['class:CLASS1', { id: 'CLASS1', name: 'Class', students: [{ code: 'AB2C', name: 'Student' }] }],
      ['scan:ABC123:AB2C:0', { worksheetId: ws.id, studentCode: 'AB2C', page: 0, scannedAt: 1, marks: { Q1: { choice: 0, status: 'ok', scores: [1], crop: { width: 2, height: 1, data: new Uint8Array([0, 255]) } } }, image: new Blob([new Uint8Array([1, 2, 255])], { type: 'image/png' }) }],
      ['grades:ABC123', { AB2C: { B1: 2 } }], ['readings:ABC123', { AB2C: { B1: { text: '42', auto: false, scannedAt: 1, box: 'x' } } }],
    ]
    const restored = parseBackup(await encodeBackup(entries))
    expect(restored[0]).toEqual(entries[0])
    expect(restored.slice(3)).toEqual(entries.slice(3))
    const scan = restored[2][1] as { image: Blob; marks: { Q1: { crop: { data: Uint8Array } } } }
    expect(new Uint8Array(await scan.image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 255]))
    expect(scan.image.type).toBe('image/png')
    expect(scan.marks.Q1.crop.data).toEqual(new Uint8Array([0, 255]))
  })
  it('rejects wrong versions, duplicate records, invalid keys and malformed worksheets', async () => {
    const text = await encodeBackup([['ws:ABC123', ws]])
    const data = JSON.parse(text)
    expect(() => parseBackup(JSON.stringify({ ...data, version: 2 }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...data, entries: [...data.entries, ...data.entries] }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...data, entries: [['settings', {}]] }))).toThrow()
    data.entries[0][1].scale = 0
    expect(() => parseBackup(JSON.stringify(data))).toThrow()
  })
  it('skips entire conflicting worksheet bundles by default', () => {
    const incoming: BackupEntry[] = [['ws:ABC123', ws], ['grades:ABC123', {}], ['class:CLASS1', {}]]
    expect(planRestore(incoming, ['ws:ABC123'], false).map(([k]) => k)).toEqual(['class:CLASS1'])
    expect(planRestore(incoming, ['ws:ABC123'], true)).toEqual(incoming)
    expect(() => planRestore([['grades:ORPHAN', {}]], [], true)).toThrow()
  })
})
