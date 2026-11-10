import { useRef, useState } from 'react'
import { ScanError, locatePage } from '../core/scan'
import type { Worksheet } from '../core/types'
import { getWorksheet, saveScan } from '../store'
import { fileToImages } from './files'
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
      const marks = page.read(size, ws.questions.filter((q) => q.page === page.page))
      await saveScan({
        worksheetId: ws.id,
        studentCode: page.studentCode,
        page: page.page,
        scannedAt: Date.now(),
        marks,
      })
      const flagged = Object.values(marks).filter((m) => m.status !== 'ok').length
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

  return (
    <div className="narrow">
      <h1>Scan finished sheets</h1>
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
        <p>Drop photos or a scanner PDF here</p>
        <div className="row center">
          <button className="primary" onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <button onClick={() => camRef.current?.click()}>Take a photo</button>
        </div>
        <p className="muted">Any order, any way up. Keep all four corner squares in the picture.</p>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
      </div>

      {items.length > 0 && (
        <>
          <div className="row between">
            <p>
              <strong>{okCount}</strong> read{failCount > 0 && <>, <strong className="bad">{failCount} not read</strong></>}
            </p>
            <div className="row">
              {[...sheets.values()].map((w) => (
                <a key={w.id} className="btn primary" href={`#/w/${w.id}/results`}>
                  Results: {w.name} →
                </a>
              ))}
            </div>
          </div>
          <ul className="scan-list">
            {items.map((it, i) => (
              <li key={i} className={it.state}>
                <span className="dot" />
                <span className="file">{it.label}</span>
                <span className="detail">{it.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
