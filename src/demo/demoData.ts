import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { contentPlacement, randomId } from '../core/layout'
import type { AnswerBox, ClassRoom, NumberGrid, Question, Worksheet } from '../core/types'

/**
 * The demo: a made-up class and a one-page quiz that uses every kind of answer Popsheet reads, plus what each
 * student "wrote", so simulated photos of the finished sheets can be run through the real scanner.
 * Nothing here is real student data.
 */

export const DEMO_NAME = 'Demo: Ratios & Rates Check-in'
export const DEMO_CLASS = 'Demo class (made-up students)'

const SIZE = { width: 612, height: 792 }
const SCALE = 0.9

const MC: { stem: string; choices: string[]; answer: number }[] = [
  { stem: 'Which ratio is equal to 2 : 5?', choices: ['4 : 10', '5 : 2', '2 : 10', '7 : 10'], answer: 0 },
  { stem: '18 apples cost $6. What is the cost per apple?', choices: ['$3', '$0.33', '$12', '$0.50'], answer: 1 },
  { stem: 'A class has 12 girls and 15 boys. The ratio of boys to girls is', choices: ['12 : 15', '4 : 5', '5 : 4', '15 : 27'], answer: 2 },
  { stem: 'Which is the better buy?', choices: ['3 for $2', '5 for $4', '2 for $1.50', '4 for $2'], answer: 3 },
  { stem: 'A car uses 4 gallons for 120 miles. Miles per gallon?', choices: ['480', '30', '40', '116'], answer: 1 },
  { stem: '3 : 4 is the same as', choices: ['75%', '34%', '43%', '7%'], answer: 0 },
  { stem: 'Which runner is the fastest?', choices: ['50 m in 10 s', '90 m in 20 s', '24 m in 4 s', '30 m in 6 s'], answer: 2 },
  { stem: 'Simplify 16 : 24', choices: ['8 : 16', '4 : 8', '3 : 2', '2 : 3'], answer: 3 },
]

/** Question 9: a number answer read from its bubbles. */
const GRID_ANSWER = '45'
/** Questions 10 and 11: written answers, graded by hand with matching answers grouped. */
const WRITTEN = [
  { label: '10', stem: ['Write the ratio 12 : 18 in simplest form.'], expected: '2:3; 2/3', points: 2 },
  { label: '11', stem: ['A recipe uses 2 cups of flour for every 3 cups of milk.', 'How much flour goes with 9 cups of milk?'], expected: '6 cups; 6', points: 2 },
]

/** One student's finished sheet. */
export interface StudentWork {
  name: string
  /** Index of the bubble filled for each multiple-choice question; null leaves it blank. */
  choices: (number | null)[]
  /** Extra marks that make a question worth a second look. */
  extra?: { q: number; choice: number; kind: 'second' | 'erased' }[]
  /** Questions filled in only lightly. */
  light?: number[]
  grid: string | null
  written: [string, string]
}

const KEY = MC.map((m) => m.answer)
const swap = (changes: Record<number, number | null>) => KEY.map((k, i) => (i in changes ? changes[i] : k))

// Question 5 is the one most of the class gets wrong the same way (they multiply instead of divide), so the
// item analysis has something to point at.
export const STUDENTS: StudentWork[] = [
  { name: 'Maya Chen', choices: swap({}), grid: '45', written: ['2:3', '6 cups'] },
  { name: 'Jordan Ellis', choices: swap({ 4: 0 }), extra: [{ q: 2, choice: 1, kind: 'second' }], grid: '45', written: ['4:6', '6'] },
  { name: 'Priya Raman', choices: swap({ 4: 0, 6: 1 }), grid: '405', written: ['2:3', '6 cups'] },
  { name: 'Sam Okafor', choices: swap({ 1: 0, 4: 0 }), light: [5], grid: '45', written: ['2/3', '6'] },
  { name: 'Lucía Ortiz', choices: swap({ 4: 0 }), extra: [{ q: 3, choice: 1, kind: 'erased' }], grid: '45', written: ['2:3', '4.5 cups'] },
  { name: 'Ben Fischer', choices: swap({ 7: null, 4: 2 }), grid: '54', written: ['3:2', '6 cups'] },
  { name: 'Amara Diallo', choices: swap({ 4: 0, 2: 1 }), grid: '45', written: ['4:6', ''] },
  { name: 'Theo Park', choices: swap({}), grid: '45', written: ['2:3', '6 cups'] },
]

export interface DemoSetup {
  worksheet: Worksheet
  classroom: ClassRoom
}

/** Builds the demo worksheet (PDF, bubbles, number grid, written-answer boxes and key) and its class. */
export async function makeDemo(taken = new Set<string>()): Promise<DemoSetup> {
  const doc = await PDFDocument.create()
  doc.setTitle('Ratios & Rates Check-in')
  const page = doc.addPage([SIZE.width, SIZE.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.1)
  const soft = rgb(0.45, 0.45, 0.45)
  const text = (s: string, x: number, top: number, size: number, f = font, color = ink) =>
    page.drawText(s, { x, y: SIZE.height - top, size, font: f, color })

  text('Ratios & Rates Check-in', 60, 70, 20, bold)
  text('Name: ______________________________      Period: ______', 60, 96, 11)

  const place = contentPlacement(SIZE, SCALE)
  const printed = (top: number) => place.y + top * SCALE

  const questions: Question[] = MC.map((item, i) => {
    const top = 128 + i * 47
    text(`${i + 1}.  ${item.stem}`, 60, top, 11.5, bold)
    // Choices in fixed columns, clear of the bubbles on the right.
    item.choices.forEach((c, j) => text(`${'ABCD'[j]})  ${c}`, 82 + j * 92, top + 18, 10.5))
    return { id: randomId(6), page: 0, x: 478, y: printed(top + 5), choices: 4, dir: 'h' as const, answer: item.answer, points: 1 }
  })

  // Question 9: number grid on the right, question text on the left.
  const gridTop = 128 + MC.length * 47
  text('9.  A cyclist rides 135 miles in 3 days, the same', 60, gridTop, 11.5, bold)
  text('distance each day. How many miles a day?', 78, gridTop + 15, 11.5, bold)
  text('Write the number in the boxes, then fill one bubble per digit.', 78, gridTop + 33, 10, font, soft)
  const grid: NumberGrid = {
    id: randomId(6),
    page: 0,
    x: 486,
    y: printed(gridTop) + 42,
    label: '9',
    columns: 3,
    decimal: false,
    negative: false,
    answer: GRID_ANSWER,
    points: 1,
  }

  // Questions 10 and 11: a ruled space to write in. Answer boxes are stored in original-page points.
  const boxes: AnswerBox[] = WRITTEN.map((w, i) => {
    const top = gridTop + 62 + i * 80
    w.stem.forEach((line, j) => text(j ? line : `${w.label}.  ${line}`, j ? 78 : 60, top + j * 15, 11.5, bold))
    const box = { x: 80, y: top + 12 + (w.stem.length - 1) * 15, width: 300, height: 44 }
    page.drawRectangle({
      x: box.x,
      y: SIZE.height - box.y - box.height,
      width: box.width,
      height: box.height,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.8,
    })
    return { id: randomId(6), page: 0, ...box, label: w.label, points: w.points, expected: w.expected }
  })

  const codes = new Set(taken)
  const classroom: ClassRoom = {
    id: randomId(6),
    name: DEMO_CLASS,
    students: STUDENTS.map((s) => {
      const code = randomId(4, codes)
      codes.add(code)
      return { name: s.name, code }
    }),
  }

  const worksheet: Worksheet = {
    id: randomId(6),
    name: DEMO_NAME,
    createdAt: Date.now(),
    pdf: await doc.save(),
    pages: [SIZE],
    scale: SCALE,
    questions,
    extras: [],
    boxes,
    grids: [grid],
  }
  return { worksheet, classroom }
}
