import { useEffect, useState } from 'react'
import { randomId } from '../core/layout'
import type { ClassRoom } from '../core/types'
import { deleteClass, listClasses, saveClass, takenCodes } from '../store'

function ClassCard({ cls, onChange }: { cls: ClassRoom; onChange: () => void }) {
  const [editing, setEditing] = useState(cls.students.length === 0)
  const [name, setName] = useState(cls.name)
  const [text, setText] = useState(cls.students.map((s) => s.name).join('\n'))

  const save = async () => {
    const taken = await takenCodes()
    const old = new Map(cls.students.map((s) => [s.name, s.code]))
    const students = [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))].map((n) => {
      // Students who were already on the list keep their code, so earlier printouts still work.
      const code = old.get(n) ?? randomId(4, taken)
      taken.add(code)
      return { name: n, code }
    })
    await saveClass({ ...cls, name: name.trim() || 'Untitled class', students })
    setEditing(false)
    onChange()
  }

  const remove = async () => {
    if (!confirm(`Delete the class "${cls.name}"? Sheets already printed for it will show codes instead of names.`)) return
    await deleteClass(cls.id)
    onChange()
  }

  if (!editing) {
    return (
      <li className="class">
        <div className="row between">
          <div>
            <div className="title">{cls.name}</div>
            <div className="muted">{cls.students.length} students</div>
          </div>
          <div className="row">
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="ghost" title="Delete class" onClick={() => void remove()}>
              ✕
            </button>
          </div>
        </div>
        <div className="chips">
          {cls.students.map((s) => (
            <span key={s.code}>
              {s.name} <code>{s.code}</code>
            </span>
          ))}
        </div>
      </li>
    )
  }
  return (
    <li className="class">
      <label className="stack">
        Class name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="stack">
        Students, one per line
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ada Lovelace\nAlan Turing'} />
      </label>
      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Save class
        </button>
        {cls.students.length > 0 && <button onClick={() => setEditing(false)}>Cancel</button>}
        {cls.students.length === 0 && <button onClick={() => void deleteClass(cls.id).then(onChange)}>Cancel</button>}
      </div>
    </li>
  )
}

export function Classes() {
  const [classes, setClasses] = useState<ClassRoom[] | null>(null)
  const load = () => void listClasses().then(setClasses)
  useEffect(load, [])

  const add = async () => {
    await saveClass({ id: randomId(6), name: `Class ${(classes?.length ?? 0) + 1}`, students: [] })
    load()
  }

  return (
    <div className="narrow">
      <div className="row between">
        <h1>Classes</h1>
        <button className="primary" onClick={() => void add()}>
          New class
        </button>
      </div>
      <p className="muted">
        Each student gets a short code. Printed sheets carry only the code, and the list that links codes to names
        is kept on this device.
      </p>
      {classes?.length === 0 && <div className="empty">No classes yet. You can still print numbered copies without one.</div>}
      <ul className="cards block">{classes?.map((c) => <ClassCard key={c.id} cls={c} onChange={load} />)}</ul>
    </div>
  )
}
