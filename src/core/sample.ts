import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { contentPlacement, randomId } from './layout'
import type { Question, Worksheet } from './types'

const ITEMS: { stem: string; choices: string[]; answer: number }[] = [
  { stem: 'Which fraction is equal to 0.5?', choices: ['1/4', '1/2', '2/3', '3/4'], answer: 1 },
  { stem: 'What is 3/4 written as a decimal?', choices: ['0.34', '0.43', '0.75', '0.8'], answer: 2 },
  { stem: 'Which is the largest?', choices: ['0.6', '0.06', '0.59', '0.509'], answer: 0 },
  { stem: 'What is 1/2 + 1/4?', choices: ['2/6', '1/6', '2/4', '3/4'], answer: 3 },
  { stem: 'Which decimal is equal to 7/10?', choices: ['0.07', '0.7', '7.0', '0.17'], answer: 1 },
  { stem: 'What is 0.25 + 0.5?', choices: ['0.75', '0.30', '0.55', '0.7'], answer: 0 },
  { stem: 'Which fraction is in simplest form?', choices: ['2/4', '3/9', '3/5', '6/8'], answer: 2 },
  { stem: 'What is 2/5 written as a decimal?', choices: ['0.25', '0.2', '0.5', '0.4'], answer: 3 },
  { stem: 'Which is the smallest?', choices: ['1/2', '1/3', '1/8', '1/5'], answer: 2 },
  { stem: 'What is 1 - 0.35?', choices: ['0.65', '0.75', '0.55', '1.35'], answer: 0 },
]

/** A ready-made quiz with bubbles already placed, for trying the app out. */
export async function makeSampleWorksheet(): Promise<Worksheet> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.1)
  page.drawText('Fractions & Decimals Quiz', { x: 60, y: 715, size: 20, font: bold, color: ink })
  page.drawText('Name: ______________________________      Date: ______________', {
    x: 60,
    y: 685,
    size: 11,
    font,
    color: ink,
  })

  const scale = 0.9
  const size = { width: 612, height: 792 }
  const place = contentPlacement(size, scale)
  const questions: Question[] = []
  ITEMS.forEach((item, i) => {
    const top = 130 + i * 58 // distance from the top of the original page
    page.drawText(`${i + 1}.  ${item.stem}`, { x: 60, y: 792 - top, size: 12, font: bold, color: ink })
    const text = item.choices.map((c, j) => `${'ABCD'[j]})  ${c}`).join('        ')
    page.drawText(text, { x: 82, y: 792 - top - 20, size: 11, font, color: ink })
    questions.push({
      id: randomId(6),
      page: 0,
      x: 470,
      y: place.y + (top + 6) * scale,
      choices: 4,
      dir: 'h',
      answer: item.answer,
      points: 1,
    })
  })

  return {
    id: randomId(6),
    name: 'Sample: Fractions & Decimals Quiz',
    createdAt: Date.now(),
    pdf: await doc.save(),
    pages: [size],
    scale,
    questions,
    extras: [],
  }
}
