import { useEffect, useState } from 'react'
import { randomId } from '../core/layout'
import { buildPrintable } from '../core/pdf'
import type { Copy } from '../core/pdf'
import type { ClassRoom, Worksheet } from '../core/types'
import { getWorksheet, listClasses, saveWorksheet, takenCodes } from '../store'
import { download } from './files'

export function Print({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [classId, setClassId] = useState('')
  const [names, setNames] = useState(true)
  const [spares, setSpares] = useState(2)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    void getWorksheet(id).then((w) => setWs(w ?? null))
    void listClasses().then((c) => {
      setClasses(c)
      if (c.length) setClassId(c[0].id)
    })
  }, [id])

  if (ws === undefined) return null
  if (ws === null) return <p className="narrow">That worksheet does not exist on this device.</p>

  const cls = classes.find((c) => c.id === classId)
  const total = (cls?.students.length ?? 0) + spares

  const make = async () => {
    setBusy(true)
    setDone('')
    try {
      const copies: Copy[] = (cls?.students ?? []).map((s) => ({ code: s.code, label: names ? s.name : '' }))
      const taken = await takenCodes()
      const extras: string[] = []
      for (let i = 0; i < spares; i++) {
        const code = randomId(4, taken)
        taken.add(code)
        extras.push(code)
        copies.push({ code, label: 'Spare copy' })
      }
      const next = { ...ws, extras: [...ws.extras, ...extras] }
      await saveWorksheet(next)
      setWs(next)
      const pdf = await buildPrintable(next, copies)
      download(`${ws.name} - bubble sheets.pdf`, pdf as BlobPart, 'application/pdf')
      setDone(`Made ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} (${copies.length * ws.pages.length} pages). Check your downloads.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="narrow">
      <a href={`#/w/${ws.id}`}>← Back to editing</a>
      <h1>Print “{ws.name}”</h1>
      {ws.questions.length === 0 && <p className="warn">This worksheet has no bubbles yet.</p>}
      <div className="form">
        <label className="stack">
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">No class, numbered copies only</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.students.length} students)
              </option>
            ))}
          </select>
        </label>
        {classes.length === 0 && (
          <p className="muted">
            <a href="#/classes">Add a class</a> to get one sheet per student with their name on it.
          </p>
        )}
        {cls && (
          <label className="check">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
            Print each student's name on their sheet
          </label>
        )}
        <label className="stack">
          Spare copies
          <input type="number" min="0" max="200" value={spares} onChange={(e) => setSpares(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} />
        </label>
        <button className="primary" disabled={busy || total === 0} onClick={() => void make()}>
          {busy ? 'Making PDF…' : `Download ${total} cop${total === 1 ? 'y' : 'ies'}`}
        </button>
        {done && <p className="ok">{done}</p>}
      </div>
      <h2>Printing tips</h2>
      <ul>
        <li>Print at 100% (“actual size”), not “fit to page”.</li>
        <li>Each copy has its own code, so print the file once instead of photocopying one sheet.</li>
        <li>Pencil or dark pen both work. Ask students to fill the bubble in completely.</li>
      </ul>
    </div>
  )
}
