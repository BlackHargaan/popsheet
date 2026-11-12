import { useEffect, useRef, useState } from 'react'
import { keepWorksheetPages } from '../core/pages'
import type { Worksheet } from '../core/types'
import { getWorksheet, listScans, savePageSelection } from '../store'
import { renderPdfPage } from './files'

function PageThumbnail({ ws, page }: { ws: Worksheet; page: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    void renderPdfPage(ws.pdf, page, .35).then(canvas => { if (live) ref.current?.replaceChildren(canvas) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [ws.pdf, page])
  return <div className="pdf-page-thumb" ref={ref}>{error ? 'Preview unavailable' : <span className="muted small">Loading page...</span>}</div>
}

export function PageManager({ ws, currentPage, onApplied, onClose }: {
  ws: Worksheet; currentPage: number; onApplied: (next: Worksheet, asCopy: boolean) => void; onClose: () => void
}) {
  const [selected, setSelected] = useState<number[]>(ws.pages.map((_, i) => i))
  const [protectedCopy, setProtectedCopy] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    void listScans(ws.id).then(scans => { if (live) setProtectedCopy(!!(ws.printed?.length || ws.extras.length || scans.length)) }).catch(() => { if (live) setError('Could not check this worksheet’s scans. Close this dialog and try again.') })
    return () => { live = false }
  }, [ws])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => { previous?.focus() }
  }, [])
  const apply = async () => {
    if (busy || !selected.length || protectedCopy === null) return
    setBusy(true); setError('')
    try {
      // Recheck before saving, including scans that arrived while the dialog was open.
      const stored = await getWorksheet(ws.id)
      if (!stored) throw new Error('This worksheet no longer exists. Close this dialog and return to the library.')
      const scans = await listScans(ws.id)
      const asCopy = !!(ws.printed?.length || stored.printed?.length || ws.extras.length || stored.extras.length || scans.length)
      const next = await keepWorksheetPages(ws, selected, asCopy)
      await savePageSelection(ws, next, asCopy)
      onApplied(next, asCopy)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the selected pages. Please try again.'); setBusy(false) }
  }
  const removedItems = [...ws.questions, ...(ws.boxes ?? []), ...(ws.grids ?? [])].filter(item => !selected.includes(item.page)).length
  return <div className="modal-back" onClick={() => { if (!busy) onClose() }}>
    <div className="modal page-manager" role="dialog" aria-modal="true" aria-labelledby="page-manager-title" ref={ref} tabIndex={-1} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose() }
      if (e.key === 'Tab') {
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
        const first = controls[0], last = controls.at(-1)
        if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }}>
      <div className="row between"><h2 id="page-manager-title">Choose PDF pages</h2><button disabled={busy} onClick={onClose} aria-label="Close page selection">✕</button></div>
      <p>Keep the pages you want to use. Uncheck the others, or choose “Only this page” to keep a single page.</p>
      {protectedCopy ? <p className="notice">This worksheet has printed copies or scans. Your selected pages will become a new worksheet, keeping the original worksheet and results available.</p> : protectedCopy === false ? <p className="muted small">This updates the worksheet. Questions on removed pages will be removed too. You can undo the change.</p> : <p role="status">Checking worksheet history...</p>}
      <div className="row page-pick-actions">
        <button disabled={busy} onClick={() => setSelected(ws.pages.map((_, i) => i))}>Select all pages</button>
        <button disabled={busy} onClick={() => setSelected([])}>Clear selection</button>
        <button disabled={busy} onClick={() => setSelected([currentPage])}>Keep only current page</button>
      </div>
      <div className="pdf-page-grid">{ws.pages.map((size, page) => <div key={page} className={'pdf-page-option' + (selected.includes(page) ? ' chosen' : '')}>
        <label><input type="checkbox" checked={selected.includes(page)} disabled={busy} aria-label={`Keep page ${page + 1}`} onChange={e => setSelected(e.target.checked ? [...selected, page] : selected.filter(i => i !== page))} />
          <PageThumbnail ws={ws} page={page} /><span>Page {page + 1}{page === currentPage ? ' · current' : ''}</span><span className="small muted">{Math.round(size.width)} × {Math.round(size.height)} pt</span>
        </label><button className="sm" disabled={busy} onClick={() => setSelected([page])} aria-label={`Keep only page ${page + 1}`}>Only this page</button>
      </div>)}</div>
      <div className="page-pick-footer">
        <p role="status">Keeping {selected.length} of {ws.pages.length} pages{removedItems ? ` · ${removedItems} answer items on excluded pages` : ''}.</p>
        {!selected.length && <p className="warn">Choose at least one page to keep.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row"><button className="primary" disabled={busy || protectedCopy === null || !selected.length || selected.length === ws.pages.length} onClick={() => void apply()}>{busy ? 'Saving pages...' : protectedCopy ? 'Save selected pages as new worksheet' : 'Keep selected pages'}</button><button disabled={busy} onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  </div>
}
