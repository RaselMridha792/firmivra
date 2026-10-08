import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const signPage = `http://portal.localhost:${port}/lvp/sign`;

test('the document draws every page', async ({ page }) => {
  await page.goto(signPage);
  const pages = page.getByTestId('pdf-page');
  await expect(pages).toHaveCount(3);
  // Pages draw as they scroll near the screen.
  for (const n of [1, 2, 3]) {
    await page.locator(`[data-page="${n}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-page="${n}"][data-drawn]`)).toBeVisible();
  }
});

test('without its worker, pdf.js still draws the document', async ({ page }) => {
  // A worker that never loads (a blocked chunk, a strict CSP) must fall back, not hang.
  await page.route(/turbopack-worker/, (route) => route.abort());
  const warnings: string[] = [];
  page.on('console', (m) => warnings.push(m.text()));
  await page.goto(signPage);
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  expect(warnings.some((w) => w.includes('running it on the main thread'))).toBeTruthy();
});
