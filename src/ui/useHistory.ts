import { useCallback, useRef, useState } from 'react'

export function useHistory<T>(save: (value: T) => void) {
  const [value, render] = useState<T | null | undefined>(undefined)
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false })
  const sync = () => setAvailability({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 })
  const current = useRef<T | null | undefined>(undefined)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const start = useRef<T | null>(null)
  const set = useCallback((next: T | null | undefined) => { current.current = next; render(next) }, [])
  const commit = (next: T) => {
    const before = start.current ?? current.current
    if (before != null && before !== next) past.current = [...past.current.slice(-99), before]
    start.current = null; future.current = []; set(next); sync(); save(next)
  }
  const travel = (redo: boolean) => {
    if (start.current) return
    const from = redo ? future : past, to = redo ? past : future
    const next = from.current.pop()
    if (next === undefined || current.current == null) return
    to.current.push(current.current); set(next); sync(); save(next)
  }
  return { value, set, commit, undo: () => travel(false), redo: () => travel(true),
    ...availability,
    begin: () => { if (current.current != null) start.current = current.current },
    finish: () => { if (start.current && current.current != null) commit(current.current) },
    cancel: () => { if (start.current) set(start.current); start.current = null },
  }
}
