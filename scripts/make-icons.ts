// Draws Popsheet's app icons (the three-bubble logo) into public/. Run with: npx tsx scripts/make-icons.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

type RGB = [number, number, number]
const INK: RGB = [0x1d, 0x1c, 0x21]
const PAPER: RGB = [0xf3, 0xef, 0xe5]
const HI: RGB = [0xff, 0xd2, 0x3f]

interface Opts {
  size: number
  /** Width of the logo as a share of the icon. */
  logo: number
  /** Corner radius as a share of the icon; null fills the whole square (maskable and Apple icons). */
  radius: number | null
}

// The header logo, on a 46 × 22 grid: two empty bubbles either side of a filled one.
const BUBBLES = [
  { x: 8, r: 6.5, fill: null },
  { x: 23, r: 7.5, fill: HI },
  { x: 38, r: 6.5, fill: null },
] as const
const STROKE = 2.2

function colourAt(px: number, py: number, o: Opts): [number, number, number, number] {
  const { size } = o
  if (o.radius !== null) {
    const r = o.radius * size
    const dx = Math.max(r - px, 0, px - (size - r))
    const dy = Math.max(r - py, 0, py - (size - r))
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0]
  }
  const s = (o.logo * size) / 46
  const lx = (px - size / 2) / s + 23
  const ly = (py - size / 2) / s + 11
  let c: RGB = INK
  for (const b of BUBBLES) {
    const d = Math.hypot(lx - b.x, ly - 11)
    if (b.fill && d <= b.r) c = b.fill
    if (Math.abs(d - b.r) <= STROKE / 2) c = PAPER
  }
  return [...c, 255]
}

function draw(o: Opts): Buffer {
  const png = new PNG({ width: o.size, height: o.size })
  const n = 4
  for (let y = 0; y < o.size; y++) {
    for (let x = 0; x < o.size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const [cr, cg, cb, ca] = colourAt(x + (i + 0.5) / n, y + (j + 0.5) / n, o)
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const k = (y * o.size + x) * 4
      png.data[k] = a ? r / a : 0
      png.data[k + 1] = a ? g / a : 0
      png.data[k + 2] = a ? b / a : 0
      png.data[k + 3] = a / (n * n)
    }
  }
  return PNG.sync.write(png)
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', draw({ size: 192, logo: 0.8, radius: 0.22 }))
writeFileSync('public/icons/icon-512.png', draw({ size: 512, logo: 0.8, radius: 0.22 }))
// Maskable icons are cropped to a circle or squircle by the device; keep the logo inside the middle 80%.
writeFileSync('public/icons/maskable-512.png', draw({ size: 512, logo: 0.66, radius: null }))
writeFileSync('public/icons/apple-touch-icon.png', draw({ size: 180, logo: 0.76, radius: null }))
console.log('Icons written to public/icons')
