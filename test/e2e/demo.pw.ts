import { expect, test } from '@playwright/test'

test('the guided demo runs a whole class through Popsheet', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const shots = process.env.DEMO_SHOTS
  let shot = 0
  const snap = async () => {
    if (shots) await page.screenshot({ path: `${shots}/${String(++shot).padStart(2, '0')}.png` })
  }

  await page.goto('/')
  await page.getByRole('button', { name: 'Watch the demo' }).click()
  const tour = page.getByRole('dialog', { name: 'Popsheet demo' })
  const next = tour.getByRole('button', { name: 'Next' })
  await expect(tour).toContainText('Welcome to Popsheet')
  await expect(page.locator('.tour-ring')).toBeVisible()
  await snap()

  // Through the editor, classes and printing.
  for (const title of [
    'Your worksheet, as it is',
    'Three kinds of answers',
    'The answer key',
    'Editing tools',
    'Classes and student codes',
    'Names stay on this device',
    'Checked before printing',
    'A true preview',
    'One coded copy per student',
  ]) {
    await next.click()
    await expect(tour).toContainText(title)
    await expect(page.locator('.tour-ring')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(900)
    await snap()
  }
  await expect(page.getByRole('region', { name: 'Layout check' })).toContainText('No overlaps or edge issues found')

  // Scanning: the simulated photos go through the real scanner.
  await next.click()
  await expect(tour).toContainText('Scan the finished sheets')
  const scanBtn = tour.getByRole('button', { name: /Scan these 8 photos/ })
  await expect(scanBtn).toBeVisible({ timeout: 60_000 })
  await snap()
  await scanBtn.click()
  await expect(tour).toContainText('All 8 sheets are read', { timeout: 120_000 })
  await expect(page.locator('.scan-list li.failed')).toHaveCount(0)
  await snap()

  // Results.
  await next.click()
  await expect(tour).toContainText('Scores straight away')
  await expect(page.locator('.table-wrap tbody tr')).toHaveCount(8)
  await snap()
  const row = (name: string) => page.locator('.table-wrap tbody tr', { hasText: name })
  await expect(row('Maya Chen')).toContainText('9/13')
  await expect(row('Theo Park')).toContainText('9/13')
  await expect(row('Jordan Ellis').locator('.c.flag')).toHaveCount(1)
  for (const title of ['Every answer, at a glance', 'Check the doubtful ones in one pass', 'What to reteach']) {
    await next.click()
    await expect(tour).toContainText(title)
    await page.waitForTimeout(900)
    await snap()
  }
  await expect(page.locator('.table-wrap tfoot')).toContainText('A ×5')

  // The highlight scrolls with the page: straight after a scroll, before the next frame, it still frames
  // its target exactly.
  await page.waitForTimeout(600)
  const drift = await page.evaluate(() => {
    const ring = document.querySelector('.tour-ring')!
    const target = document.querySelector('.table-wrap tfoot')!
    const out: number[] = []
    for (const y of [0, 120, 400, 60]) {
      scrollTo(0, y)
      const a = ring.getBoundingClientRect()
      const b = target.getBoundingClientRect()
      out.push(Math.abs(a.top + 6 - b.top), Math.abs(a.left + 6 - b.left))
    }
    return Math.max(...out)
  })
  expect(drift).toBeLessThan(1)

  // Written answers are grouped.
  await next.click()
  await expect(tour).toContainText('Written answers, grouped')
  await expect(page.locator('.group-list .group-card').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.group-list')).toContainText('2:3')
  await page.waitForTimeout(900)
  await snap()

  await next.click()
  await expect(tour).toContainText('Into your gradebook')
  await snap()
  await next.click()
  await expect(tour).toContainText("That's Popsheet")
  await snap()

  // Removing the demo leaves nothing behind.
  await tour.getByRole('button', { name: 'Remove demo data' }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Demo: Ratios/ })).toHaveCount(0)
  await page.goto('/#/classes')
  await expect(page.getByText('Demo class')).toHaveCount(0)
  expect(errors).toEqual([])
})
