import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

async function upload(page: Page) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 5; i++) doc.addPage([612 + i * 10, 792]).drawText(`Original page ${i + 1}`, { x: 100, y: 600, font })
  await page.goto('/')
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles({ name: 'Five pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) })
  await expect(page.getByRole('textbox', { name: 'Worksheet name' })).toHaveValue('Five pages')
}

test('keep a single page, undo/redo and print only the retained PDF page', async ({ page }) => {
  await upload(page)
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Bubbles', exact: true }).click()
  await page.locator('.add-layer').click({ position: { x: 200, y: 200 } })
  await page.getByRole('button', { name: 'Manage PDF pages' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose PDF pages' })
  await expect(dialog.getByRole('checkbox')).toHaveCount(5)
  await dialog.getByRole('button', { name: 'Keep only page 3', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Keep page 3', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: 'Keep selected pages', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.page svg .q')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Manage PDF pages' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Manage PDF pages' })).toBeVisible()
  // Navigate beyond the reduced page count before redo to verify that the editor clamps its page.
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.page svg .q')).toHaveCount(1)
  await page.reload()
  const stored = await page.evaluate(async () => {
    const store = await import('/src/store.ts'); const [ws] = await store.listWorksheets()
    return { count: ws.pages.length, width: ws.pages[0].width, questionPage: ws.questions[0].page }
  })
  expect(stored).toEqual({ count: 1, width: 632, questionPage: 0 })
  await page.getByRole('link', { name: /Print copies/ }).click()
  await expect(page.getByRole('region', { name: 'Print preview' })).toContainText('Page 1 of 1')
  await expect(page.locator('.print-preview-page canvas')).toBeVisible()
})

test('page selection requires one page, cancels cleanly, and supports keeping several', async ({ page }) => {
  await upload(page)
  await page.getByRole('button', { name: 'Manage PDF pages' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose PDF pages' })
  await dialog.getByRole('button', { name: 'Clear selection' }).click()
  await expect(dialog.getByRole('button', { name: 'Keep selected pages', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Manage PDF pages' }).click()
  await dialog.getByRole('checkbox', { name: 'Keep page 2', exact: true }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Keep page 4', exact: true }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Keep page 5', exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Keep selected pages', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.toolbar .pager')).toContainText('Page 1 of 2')
})

test('worksheets with scans create a new worksheet and preserve their original pages and results', async ({ page }) => {
  await upload(page)
  const originalId = await page.evaluate(async () => {
    const store = await import('/src/store.ts'); const [ws] = await store.listWorksheets()
    await store.saveScan({ worksheetId: ws.id, studentCode: 'AB2C', page: 3, scannedAt: 1, marks: {} })
    return ws.id
  })
  await page.getByRole('button', { name: 'Manage PDF pages' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose PDF pages' })
  await expect(dialog).toContainText('selected pages will become a new worksheet')
  await dialog.getByRole('button', { name: 'Keep only page 4', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save selected pages as new worksheet' }).click()
  await expect(page.getByRole('textbox', { name: 'Worksheet name' })).toHaveValue('Five pages (selected pages)')
  const state = await page.evaluate(async originalId => {
    const store = await import('/src/store.ts')
    return { count: (await store.listWorksheets()).length, pages: (await store.getWorksheet(originalId)).pages.length, scans: (await store.listScans(originalId)).length }
  }, originalId)
  expect(state).toEqual({ count: 2, pages: 5, scans: 1 })
})


test('page thumbnails and selection fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await upload(page)
  await page.getByRole('button', { name: 'Manage PDF pages' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose PDF pages' })
  await expect(dialog.locator('.pdf-page-thumb canvas')).toHaveCount(5)
  await page.screenshot({ path: 'test-results/page-manager-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await dialog.getByRole('button', { name: 'Keep only page 5', exact: true }).click()
  await dialog.getByRole('button', { name: 'Keep selected pages', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage PDF pages' })).not.toBeVisible()
})
