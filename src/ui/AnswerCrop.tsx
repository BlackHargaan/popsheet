import { useEffect, useRef, useState } from 'react'
import type { AnswerBox, ScanRecord, Worksheet } from '../core/types'
import { PAD, answerRect } from './answerImages'
import { cropScan } from './files'

export function AnswerCrop({ rec, ws, box }: { rec: ScanRecord; ws: Worksheet; box: AnswerBox }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!rec.image || !rec.ppp) return
    let live = true
    cropScan(rec.image, rec.ppp, answerRect(ws, rec, box))
      .then((bmp) => {
        const c = ref.current
        if (!live || !c) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [rec, ws, box])

  if (!rec.image || !rec.ppp) {
    return <div className="crop-missing">Scanned before answer boxes existed. Scan this page again to grade it here.</div>
  }
  if (failed) return <div className="crop-missing">This answer could not be shown.</div>
  const aspect = `${box.width + (2 * PAD) / ws.scale} / ${box.height + (2 * PAD) / ws.scale}`
  return <canvas ref={ref} className="answer-crop" style={{ aspectRatio: aspect }} />
}
