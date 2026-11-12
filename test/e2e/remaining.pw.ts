import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function sample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the sample quiz' }).click()
  await expect(page.locator('.page svg .q')).toHaveCount(10)
}

test('duplicate batches, undo, and independent worksheet copies', async ({ page }) => {
  await sample(page)
  await page.locator('.page svg .q > .q-box').first().click({ position: { x: 2, y: 2 } })
  await page.getByRole('spinbutton', { name: 'Number of duplicates' }).fill('2')
  await page.getByRole('button', { name: 'Duplicate selection' }).click()
  await expect(page.locator('.page svg .q')).toHaveCount(12)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.page svg .q')).toHaveCount(10)
  await page.getByRole('link', { name: 'All worksheets' }).click()
  await page.getByRole('button', { name: /^Duplicate worksheet/ }).click()
  await expect(page.locator('.sheet')).toHaveCount(2)
  await page.getByRole('link', { name: /Quiz \(copy\)/ }).click()
  await expect(page.locator('.page svg .q')).toHaveCount(10)
  await page.getByRole('textbox', { name: 'Worksheet name' }).fill('Independent copy')
  await page.getByRole('link', { name: 'All worksheets' }).click()
  await expect(page.getByRole('link', { name: 'Independent copy', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sample: Fractions & Decimals Quiz', exact: true })).toBeVisible()
})

test('print layout warnings and preview do not record a print or spare codes', async ({ page }) => {
  await sample(page)
  // Seed an intentional overlap using the real application store in this isolated browser profile.
  await page.evaluate(async () => {
    const store = await import('/src/store.ts')
    const [ws] = await store.listWorksheets()
    ws.pageCodes = [{ x: ws.questions[0].x, y: ws.questions[0].y }]
    await store.saveWorksheet(ws)
  })
  await page.reload()
  await page.getByRole('link', { name: /Print copies/ }).click()
  await expect(page.getByRole('region', { name: 'Layout check' })).toContainText('overlaps page code')
  await expect(page.locator('.print-preview-page canvas')).toBeVisible()
  const stored = await page.evaluate(async () => {
    const store = await import('/src/store.ts')
    const [ws] = await store.listWorksheets()
    return { printed: ws.printed?.length ?? 0, extras: ws.extras.length }
  })
  expect(stored).toEqual({ printed: 0, extras: 0 })
  await page.screenshot({ path: 'test-results/print-preview.png', fullPage: true })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toContain('bubble sheets.pdf')
  await expect(page.getByText(/Made 2 copies/)).toBeVisible()
})

test('review filters, skip, progress and confirmed blanks persist', async ({ page }) => {
  await sample(page)
  await page.evaluate(async () => {
    const store = await import('/src/store.ts')
    const [ws] = await store.listWorksheets()
    const marks = Object.fromEntries(ws.questions.map((q: { id: string }, i: number) => [q.id, { choice: i < 2 ? null : 0, status: i === 0 ? 'blank' : i === 1 ? 'multi' : i === 2 ? 'unsure' : 'ok', scores: [0, 0, 0, 0] }]))
    ws.extras = ['AB2C']
    await store.saveWorksheet(ws)
    await store.saveScan({ worksheetId: ws.id, studentCode: 'AB2C', page: 0, scannedAt: 1, marks })
  })
  await page.getByRole('link', { name: 'Results', exact: true }).click()
  const queue = page.getByRole('region', { name: 'Scan review queue' })
  await expect(queue).toContainText('3 answers need a check')
  await page.getByRole('combobox', { name: 'Review filter' }).selectOption('multi')
  await expect(queue.getByRole('button', { name: 'Review 1 answers' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Review filter' }).selectOption('all')
  await queue.getByRole('button', { name: 'Review 3 answers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review answer', exact: true })
  await expect(dialog).toContainText('Question 1')
  await dialog.getByRole('button', { name: 'Skip for now' }).click()
  await expect(dialog).toContainText('Question 2')
  await dialog.getByRole('button', { name: 'A', exact: true }).click()
  await expect(dialog).toContainText('Question 3')
  await expect(dialog).toContainText('1 reviewed')
  await dialog.getByRole('button', { name: 'B', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(queue).toContainText('1 skipped for now')
  await queue.getByRole('button', { name: 'Review 1 answers' }).click()
  await dialog.getByRole('button', { name: 'No answer', exact: true }).click()
  await expect(queue).toContainText('No scan answers need review')
  await page.reload()
  await expect(queue).toContainText('No scan answers need review')
})

test('blank and uncertain number answers can be reviewed and stay resolved', async ({ page }) => {
  await sample(page)
  await page.evaluate(async () => {
    const store = await import('/src/store.ts')
    const [ws] = await store.listWorksheets()
    ws.grids = [
      { id: 'GRID1', page: 0, x: 300, y: 200, label: '11', columns: 1, decimal: false, negative: false, answer: '1', points: 1 },
      { id: 'GRID2', page: 0, x: 350, y: 200, label: '12', columns: 1, decimal: false, negative: false, answer: '3', points: 1 },
    ]
    const marks = Object.fromEntries(ws.questions.map((q: { id: string }) => [q.id, { choice: 0, status: 'ok', scores: [1, 0, 0, 0] }]))
    marks['GRID1.0'] = { choice: null, status: 'blank', scores: Array(10).fill(0) }
    marks['GRID2.0'] = { choice: null, status: 'multi', scores: Array(10).fill(.5) }
    await store.saveWorksheet(ws)
    await store.saveScan({ worksheetId: ws.id, studentCode: 'AB2C', page: 0, scannedAt: 1, marks })
  })
  await page.getByRole('link', { name: 'Results', exact: true }).click()
  const queue = page.getByRole('region', { name: 'Scan review queue' })
  await expect(queue).toContainText('2 answers need a check')
  await page.getByRole('combobox', { name: 'Review filter' }).selectOption('blank')
  await queue.getByRole('button', { name: 'Review 1 answers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review number answer' })
  await expect(dialog).toContainText('Question 11')
  await dialog.getByRole('button', { name: 'No answer' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('combobox', { name: 'Review filter' }).selectOption('number')
  await queue.getByRole('button', { name: 'Review 1 answers' }).click()
  await expect(dialog).toContainText('Question 12')
  await dialog.getByRole('textbox', { name: "The student's answer" }).fill('3')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(queue).toContainText('No scan answers need review')
})

test('preview navigates multiple pages and detects original text under a code', async ({ page }) => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([612, 792]).drawText('Original question text', { x: 100, y: 620, size: 16, font })
  pdf.addPage([612, 792])
  await page.goto('/')
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({ name: 'Two pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await expect(page.getByRole('textbox', { name: 'Worksheet name' })).toHaveValue('Two pages')
  await page.evaluate(async () => {
    const store = await import('/src/store.ts')
    const [ws] = await store.listWorksheets()
    ws.pageCodes = [{ x: 95, y: 150 }]
    await store.saveWorksheet(ws)
  })
  await page.reload()
  await page.getByRole('link', { name: /Print copies/ }).click()
  const check = page.getByRole('region', { name: 'Layout check' })
  await expect(check).toContainText('Page code covers text or artwork')
  await expect(page.locator('.print-preview-page canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await expect(page.getByRole('region', { name: 'Print preview' })).toContainText('Page 2 of 2')
  await expect(page.locator('.print-preview-page canvas')).toBeVisible()
  await check.getByRole('button', { name: 'Page 1', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Print preview' })).toContainText('Page 1 of 2')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
