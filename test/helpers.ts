import type { PNG } from 'pngjs'
import type { Pt } from '../src/core/layout'
import { applyH, solveHomography } from '../src/core/scan'
import type { Rgba } from '../src/core/scan'

/** seeded noise */
export function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Simulates a phone photo: page corners land on `quad` (TL, TR, BR, BL) in a w x h picture. */
export function photograph(src: PNG, w: number, h: number, quad: Pt[], shade = 0): Rgba {
  const corners = [
    { x: 0, y: 0 },
    { x: src.width, y: 0 },
    { x: src.width, y: src.height },
    { x: 0, y: src.height },
  ]
  const inv = solveHomography(quad, corners)
  const out = new Uint8ClampedArray(w * h * 4)
  const rand = rng(3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = applyH(inv, { x, y })
      let v = [70, 52, 40] // desk
      if (p.x >= 0 && p.y >= 0 && p.x < src.width - 1 && p.y < src.height - 1) {
        const x0 = Math.floor(p.x)
        const y0 = Math.floor(p.y)
        const fx = p.x - x0
        const fy = p.y - y0
        v = [0, 1, 2].map((ch) => {
          const at = (xx: number, yy: number) => src.data[(yy * src.width + xx) * 4 + ch]
          return (
            at(x0, y0) * (1 - fx) * (1 - fy) +
            at(x0 + 1, y0) * fx * (1 - fy) +
            at(x0, y0 + 1) * (1 - fx) * fy +
            at(x0 + 1, y0 + 1) * fx * fy
          )
        })
      }
      const light = 1 - shade * ((x / w) * 0.6 + (y / h) * 0.4)
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) out[i + ch] = v[ch] * light * 0.93 + (rand() - 0.5) * 12
      out[i + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

