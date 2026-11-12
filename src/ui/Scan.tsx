import { useEffect, useRef, useState } from 'react'
import { gridQuestions, readGrid } from '../core/grids'
import { ScanError, locatePage } from '../core/scan'
import type { Worksheet } from '../core/types'
import { getWorksheet, saveScan } from '../store'
import { layoutForScan } from '../core/versions'
import { SCAN_PPP, fileToImages, grayToBlob } from './files'
import { Arrow } from './icons'
import { modelIsCached } from './reader'
import { answersLeftToRead, jobsForPages, onReading, queueReading } from './readingQueue'
import type { ScanImage } from './files'

interface Item {
  label: string
  state: 'working' | 'ok' | 'failed'
  detail: string
  worksheet?: Worksheet
}

async function readOne(img: ScanImage): Promise<{ detail: string; worksheet: Worksheet }> {
  let lastError: unknown
  // Try a quick working size first, then a bigger one for small or distant pages.
  for (const maxDim of [2000, 3400]) {
    try {
      const page = locatePage(await img.get(maxDim))
      const ws = await getWorksheet(page.worksheetId)
      if (!ws) throw new ScanError('This page belongs to a worksheet that is not on this device.')
      const size = ws.pages[page.page]
      if (!size) throw new ScanError('This page does not match the worksheet.')
      const layout = layoutForScan(ws, page.version)
      if (!layout) {
        throw new ScanError(
          `This sheet was printed as version ${page.version} of the worksheet, which isn't on this device.`,
        )
      }
      const questions = layout.questions.filter((q) => q.page === page.page)
      const grids = layout.grids.filter((g) => g.page === page.page)
      const position = layout.pageCodes?.[page.page]
      const marks = page.read(size, questions, true, position)
      // Number grids are read on their own, so their many empty bubbles don't shift what "empty" means
      // for the multiple-choice questions.
      if (grids.length) Object.assign(marks, page.read(size, grids.flatMap(gridQuestions), false, position))
      // Keep a straightened copy of the page (on this device only) so written answers can be cropped and
      // graded, including from answer boxes drawn after scanning.
      const image = await grayToBlob(page.straighten(size, SCAN_PPP, position))
      await saveScan({
        worksheetId: ws.id,
        studentCode: page.studentCode,
        page: page.page,
        scannedAt: Date.now(),
        marks,
        ...(page.version !== null && { version: page.version }),
        image,
        ppp: SCAN_PPP,
      })
      // Read this page's written answers in the background, so they are grouped by the time the teacher
      // grades. Only once the handwriting model is on the device: the download is the teacher's choice.
      if (ws.boxes?.some((b) => b.page === page.page) && (await modelIsCached())) {
        queueReading(await jobsForPages(ws.id, [{ code: page.studentCode, page: page.page }]))
      }
      const flagged =
        questions.filter((q) => marks[q.id].status !== 'ok').length +
        grids.filter((g) => readGrid(g, marks)?.status === 'review').length
      return {
        worksheet: ws,
        detail: `${ws.name}${ws.pages.length > 1 ? `, page ${page.page + 1}` : ''} · ${page.studentCode}${
          flagged ? ` · ${flagged} to check` : ''
        }`,
      }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

export function Scan() {
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const queue = useRef(Promise.resolve())
  const [toRead, setToRead] = useState(answersLeftToRead)
  useEffect(() => onReading(() => setToRead(answersLeftToRead())), [])

  const add = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      queue.current = queue.current.then(async () => {
        let images: ScanImage[]
        try {
          images = await fileToImages(file)
        } catch {
          setItems((x) => [...x, { label: file.name, state: 'failed', detail: 'This file could not be opened.' }])
          return
        }
        for (const img of images) {
          const item: Item = { label: img.label, state: 'working', detail: 'Reading…' }
          setItems((x) => [...x, item])
          const patch = (p: Partial<Item>) => setItems((x) => x.map((it) => (it === item ? Object.assign(item, p) : it)).slice())
          // Let the "Reading…" row paint before the heavy work starts.
          await new Promise((r) => setTimeout(r, 20))
          try {
            const r = await readOne(img)
            patch({ state: 'ok', ...r })
          } catch (e) {
            patch({ state: 'failed', detail: e instanceof ScanError ? e.message : 'This page could not be read.' })
          }
        }
      })
    }
  }

  const sheets = new Map<string, Worksheet>()
  for (const it of items) if (it.worksheet) sheets.set(it.worksheet.id, it.worksheet)
  const okCount = items.filter((i) => i.state === 'ok').length
  const failCount = items.filter((i) => i.state === 'failed').length

  const working = items.filter((i) => i.state === 'working').length

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">Grade</div>
          <h1>Scan finished sheets</h1>
          <p>Drop in the whole stack at once. Each page is matched to its worksheet and student by its code.</p>
        </div>
      </div>
      <div
        className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        }}
      >
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <svg className="scan-ill" width="74" height="84" viewBox="0 0 74 84" aria-hidden="true">
          <rect x="6" y="4" width="62" height="76" rx="3" fill="var(--card)" stroke="currentColor" strokeWidth="1.8" />
          <rect x="11" y="9" width="5" height="5" fill="currentColor" />
          <rect x="58" y="9" width="5" height="5" fill="currentColor" />
          <rect x="11" y="70" width="5" height="5" fill="currentColor" />
          <rect x="58" y="70" width="5" height="5" fill="currentColor" />
          {[24, 38, 52].map((y) => (
            <g key={y}>
              <rect x="16" y={y - 1.5} width="18" height="3" rx="1.5" fill="var(--line)" />
              <circle cx="42" cy={y} r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="51" cy={y} r="3.2" fill={y === 38 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
              <circle cx="60" cy={y} r="3.2" fill={y === 24 || y === 52 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
            </g>
          ))}
          <rect className="beam" x="0" y="18" width="74" height="3" rx="1.5" fill="#ffd23f" opacity="0.9" />
        </svg>
        <h2>Drop photos or a scanner PDF</h2>
        <p className="muted">Any order, any way up. Keep all four corner squares in the picture.</p>
        <div className="row center">
          <button className="primary" onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <button onClick={() => camRef.current?.click()}>Take a photo</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
      </div>

      {items.length > 0 && (
        <>
          <div className="scan-summary">
            <div className="counts">
              <span className="count-pill ok">{okCount} read</span>
              {failCount > 0 && <span className="count-pill bad">{failCount} not read</span>}
              {working > 0 && <span className="count-pill">{working} reading…</span>}
              {toRead > 0 && (
                <span className="count-pill" title="Read on this device so matching answers are grouped for grading. Keep Popsheet open until it finishes.">
                  {toRead} written answer{toRead === 1 ? '' : 's'} to read
                </span>
              )}
            </div>
            <div className="row">
              {[...sheets.values()].map((w) => (
                <a key={w.id} className="btn primary" href={`#/w/${w.id}/results`}>
                  {sheets.size > 1 ? `Results: ${w.name}` : 'See results'} <Arrow />
                </a>
              ))}
            </div>
          </div>
          <ul className="scan-list panel" aria-live="polite">
            {items.map((it, i) => (
              <li key={i} className={it.state}>
                <span className="state-ic" aria-hidden="true">
                  {it.state === 'ok' ? '✓' : it.state === 'failed' ? '!' : ''}
                </span>
                <span className="file">{it.label}</span>
                <span className="detail">
                  {it.detail.includes(' to check') ? (
                    <>
                      {it.detail.replace(/ · \d+ to check$/, '')} · <span className="flagged">{it.detail.match(/(\d+) to check$/)?.[1]} to check</span>
                    </>
                  ) : (
                    it.detail
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
