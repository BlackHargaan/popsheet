import { useEffect, useRef, useState } from 'react'
import { buildPrintable } from '../core/pdf'
import { codeCoversInk } from '../core/layoutWarnings'
import type { Copy } from '../core/pdf'
import type { Worksheet } from '../core/types'
import { versionForPrint } from '../core/versions'
import { renderPdfPage } from './files'

export function PrintPreview({ ws, copy, page, setPage, onCovered }: {
  ws: Worksheet; copy: Copy; page: number; setPage: (page: number) => void; onCovered: (pages: number[]) => void
}) {
  const [rendered, setRendered] = useState<{ ws: Worksheet; code: string; label: string; pdf: Uint8Array } | null>(null)
  const pdf = rendered?.ws === ws && rendered.code === copy.code && rendered.label === copy.label ? rendered.pdf : null
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const version = versionForPrint(ws).version
    void buildPrintable(ws, [{ code: copy.code, label: copy.label }], version).then(bytes => { if (live) { setRendered({ ws, code: copy.code, label: copy.label, pdf: bytes }); setError('') } }).catch(() => { if (live) setError('Could not generate the preview. Please check the worksheet PDF.') })
    return () => { live = false }
  }, [ws, copy.code, copy.label])
  useEffect(() => {
    let live = true
    void (async () => {
      const covered: number[] = []
      for (let page = 0; page < ws.pages.length; page++) {
        const canvas = await renderPdfPage(ws.pdf, page, 1)
        if (!live) return
        const context = canvas.getContext('2d')!
        if (codeCoversInk(ws, page, context.getImageData(0, 0, canvas.width, canvas.height))) covered.push(page)
      }
      onCovered(covered)
    })().catch(() => { if (live) setError('Could not check the original page for content under the page code. Inspect the preview before printing.') })
    return () => { live = false }
  }, [ws, onCovered])
  useEffect(() => {
    let live = true
    ref.current?.replaceChildren()
    if (pdf) void renderPdfPage(pdf, page, 1.4).then(canvas => { if (live) ref.current?.replaceChildren(canvas) }).catch(() => { if (live) setError('Could not render this preview page.') })
    return () => { live = false }
  }, [pdf, page])
  return <section className="panel pad print-preview" aria-label="Print preview">
    <div className="row between"><h2>Print preview</h2><span className="pager">
      <button aria-label="Previous preview page" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
      Page {page + 1} of {ws.pages.length}
      <button aria-label="Next preview page" disabled={page === ws.pages.length - 1} onClick={() => setPage(page + 1)}>›</button>
    </span></div>
    <p className="small muted">One copy, rendered from the PDF that will be printed. Check that codes and answer bubbles leave the questions readable.</p>
    {!pdf && !error && <p role="status">Generating preview...</p>}
    <div ref={ref} className="print-preview-page" />
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
