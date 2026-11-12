import { layoutWarnings } from '../core/layoutWarnings'
import { PrintPreview } from './PrintPreview'
import { useEffect, useState } from 'react'
import { randomId } from '../core/layout'
import { buildPrintable } from '../core/pdf'
import type { Copy } from '../core/pdf'
import type { ClassRoom, Worksheet } from '../core/types'
import { changedSincePrint, latestPrinted, versionForPrint } from '../core/versions'
import { getWorksheet, listClasses, saveWorksheet, takenCodes } from '../store'
import { download } from './files'
import { Back, Missing } from './icons'

export function Print({ id }: { id: string }) {
  const [ws, setWs] = useState<Worksheet | null | undefined>(undefined)
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [classId, setClassId] = useState('')
  const [names, setNames] = useState(true)
  const [spares, setSpares] = useState(2)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [previewPage, setPreviewPage] = useState(0)
  const [covered, setCovered] = useState<number[] | null>(null)

  useEffect(() => {
    void getWorksheet(id).then((w) => setWs(w ?? null))
    void listClasses().then((c) => {
      setClasses(c)
      if (c.length) setClassId(c[0].id)
    })
  }, [id])

  if (ws === undefined) return null
  if (ws === null) return <Missing />

  const cls = classes.find((c) => c.id === classId)
  const students = cls?.students.length ?? 0
  const total = students + spares
  const setSpareCount = (n: number) => setSpares(Math.max(0, Math.min(200, n)))
  const grids = ws.grids ?? []
  const unkeyed = ws.questions.filter((q) => q.answer === null).length + grids.filter((g) => g.answer === null).length
  const items = ws.questions.length + grids.length + (ws.boxes ?? []).length

  const warnings = [...layoutWarnings(ws), ...(covered ?? []).map(page => ({ page, ids: ['page-code'], message: 'Page code covers text or artwork on the original worksheet. Move it to a clear space.' }))]
  const firstStudent = cls?.students[0]
  const previewCopy = { code: firstStudent?.code ?? 'PREVIEW', label: firstStudent ? (names ? firstStudent.name : '') : 'Spare copy' }

  const make = async () => {
    setBusy(true)
    setDone('')
    setError('')
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
      // Records this print's bubble layout (or reuses the last one) so these sheets are always read correctly.
      const { ws: next, version } = versionForPrint({ ...ws, extras: [...ws.extras, ...extras] })
      const pdf = await buildPrintable(next, copies, version)
      await saveWorksheet(next)
      setWs(next)
      download(`${ws.name} - bubble sheets.pdf`, pdf as BlobPart, 'application/pdf')
      setDone(`Made ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} (${copies.length * ws.pages.length} pages). Check your downloads.`)
    } catch {
      setError('Could not make the printable PDF. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wide" style={{ maxWidth: 980 }}>
      <Back href={`#/w/${ws.id}`}>Back to editing</Back>
      <div className="page-head">
        <div>
          <div className="eyebrow">Print</div>
          <h1>{ws.name}</h1>
          <p>
            {items} question{items === 1 ? '' : 's'} · {ws.pages.length} page
            {ws.pages.length === 1 ? '' : 's'} per copy
            {latestPrinted(ws) && ` · last printed as version ${latestPrinted(ws)!.version}`}
          </p>
        </div>
      </div>

      <section className="panel pad layout-check" aria-label="Layout check">
        <h2>Layout check</h2>
        {covered === null && <p className="small muted" role="status">Checking the original worksheet for content under the page code...</p>}
        {warnings.length ? <><p className="warn">{warnings.length} possible layout issue{warnings.length === 1 ? '' : 's'} to check before printing.</p>
          <ul>{warnings.map((warning, i) => <li key={i}><button className="link" onClick={() => setPreviewPage(warning.page)}>Page {warning.page + 1}</button>: {warning.message}</li>)}</ul>
          <a href={`#/w/${ws.id}`}>Fix the layout in the editor</a></> : <p>No overlaps or edge issues found. Check the preview for anything covering worksheet content.</p>}
      </section>
      <PrintPreview ws={ws} copy={previewCopy} page={previewPage} setPage={setPreviewPage} onCovered={setCovered} />
      <div className="print-grid">
        <div>
          {items === 0 && <p className="warn">This worksheet has no questions yet, so there is nothing to grade.</p>}
          {changedSincePrint(ws) && (
            <p className="notice">
              You've moved or changed bubbles since printing version {latestPrinted(ws)!.version}. These copies will be
              version {latestPrinted(ws)!.version + 1}. Copies you printed earlier still scan correctly.
            </p>
          )}
          {unkeyed > 0 && (
            <p className="warn">
              {unkeyed} question{unkeyed === 1 ? ' has' : 's have'} no answer marked. You can print now and mark the key
              later; scores update when you do.
            </p>
          )}
          <div className="panel pad">
            <label className="stack">
              Who is it for?
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">No class, numbered copies only</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.students.length} students)
                  </option>
                ))}
              </select>
              {classes.length === 0 && (
                <span className="help">
                  <a href="#/classes">Add a class</a> to get one sheet per student with their name on it.
                </span>
              )}
            </label>
            {cls && (
              <label className="check">
                <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
                Print each student's name on their sheet
              </label>
            )}
            <div className="stack" style={{ marginBottom: 0 }}>
              <span>
                Spare copies <span className="help">for new students or do-overs</span>
              </span>
              <div className="number-input">
                <button onClick={() => setSpareCount(spares - 1)} aria-label="One fewer spare" disabled={spares === 0}>
                  −
                </button>
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={spares}
                  aria-label="Spare copies"
                  onChange={(e) => setSpareCount(Number(e.target.value) || 0)}
                />
                <button onClick={() => setSpareCount(spares + 1)} aria-label="One more spare">
                  +
                </button>
              </div>
            </div>
          </div>

          <h2>Before you print</h2>
          <ul className="tips">
            <li>
              <span className="ic" aria-hidden="true">
                1:1
              </span>
              <div>
                <b>Print at actual size</b>
                <span>Choose 100% (“actual size”), not “fit to page”.</span>
              </div>
            </li>
            <li>
              <span className="ic" aria-hidden="true">
                #
              </span>
              <div>
                <b>Don't photocopy one sheet</b>
                <span>Every copy has its own code, so print the whole file once.</span>
              </div>
            </li>
            <li>
              <span className="ic" aria-hidden="true">
                ●
              </span>
              <div>
                <b>Fill bubbles completely</b>
                <span>Pencil or dark pen both work.</span>
              </div>
            </li>
          </ul>
        </div>

        <aside className="panel summary">
          <div className="stackpaper" aria-hidden="true">
            <i />
            <i />
            <i>
              <b style={{ width: '70%' }} />
              <b />
              <b style={{ width: '85%' }} />
              <s />
              <b style={{ width: '60%' }} />
              <s />
            </i>
          </div>
          <div className="big-num">{total}</div>
          <div className="muted">cop{total === 1 ? 'y' : 'ies'}</div>
          <div className="breakdown">
            {students > 0 && (
              <>
                {students} named
                {spares > 0 && ' + '}
              </>
            )}
            {spares > 0 && `${spares} spare`}
            {total > 0 && ` · ${total * ws.pages.length} pages`}
          </div>
          <button className="primary" disabled={busy || total === 0} onClick={() => void make()}>
            {busy ? 'Making PDF…' : 'Download PDF'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          {done && <p className="notice" style={{ marginTop: '0.8rem' }}>{done}</p>}
        </aside>
      </div>
    </div>
  )
}
