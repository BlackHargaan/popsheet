import { useEffect, useState } from 'react'
import { randomId } from '../core/layout'
import type { ClassRoom } from '../core/types'
import { deleteClass, listClasses, saveClass, takenCodes } from '../store'
import { Lock } from './icons'

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase()
}

function ClassCard({ cls, onChange }: { cls: ClassRoom; onChange: () => void }) {
  const [editing, setEditing] = useState(cls.students.length === 0)
  const [name, setName] = useState(cls.name)
  const [text, setText] = useState(cls.students.map((s) => s.name).join('\n'))
  const count = new Set(text.split('\n').map((s) => s.trim()).filter(Boolean)).size

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
      <li className="panel class-card">
        <div className="head">
          <div className="row" style={{ gap: '0.9rem' }}>
            <span className="avatar" aria-hidden="true">
              {initials(cls.name)}
            </span>
            <div>
              <h3>{cls.name}</h3>
              <div className="count">
                {cls.students.length} student{cls.students.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="row">
            <button className="sm" onClick={() => setEditing(true)}>
              Edit list
            </button>
            <button className="ghost sm" title="Delete class" aria-label={`Delete ${cls.name}`} onClick={() => void remove()}>
              ✕
            </button>
          </div>
        </div>
        <div className="chips">
          {cls.students.map((s) => (
            <span key={s.code}>
              {s.name} <code title="Code printed on this student's sheet">{s.code}</code>
            </span>
          ))}
        </div>
      </li>
    )
  }
  return (
    <li className="panel class-card">
      <label className="stack">
        Class name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={cls.students.length === 0} />
      </label>
      <label className="stack">
        <span className="row between">
          Students, one per line
          <span className="help">{count} so far · paste straight from a spreadsheet</span>
        </span>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ada Lovelace\nAlan Turing\nGrace Hopper'} />
      </label>
      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Save class
        </button>
        {cls.students.length > 0 && (
          <button className="quiet" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
        {cls.students.length === 0 && (
          <button className="quiet" onClick={() => void deleteClass(cls.id).then(onChange)}>
            Cancel
          </button>
        )}
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
      <div className="page-head">
        <div>
          <div className="eyebrow">Rosters</div>
          <h1>Classes</h1>
        </div>
        <button className="primary" onClick={() => void add()}>
          New class
        </button>
      </div>
      <div className="panel privacy">
        <Lock size={18} />
        <div>
          Each student gets a short code. Printed sheets carry only the code; the list that links codes to names never
          leaves this device.
        </div>
      </div>
      {classes?.length === 0 && (
        <div className="panel empty-state">
          <div className="ill" aria-hidden="true">
            <i />
            <i className="f" />
            <i />
          </div>
          <h2>No classes yet</h2>
          <p>Add a class to print one named sheet per student. You can still print numbered copies without one.</p>
          <button className="primary" onClick={() => void add()}>
            Add your first class
          </button>
        </div>
      )}
      <ul className="class-list">
        {classes?.map((c) => <ClassCard key={c.id} cls={c} onChange={load} />)}
      </ul>
    </div>
  )
}
