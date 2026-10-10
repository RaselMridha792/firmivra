import { expect, test } from '@playwright/test';

// One Begin Online lead in mock mode, as an owner. The mock has Avery Sample (new, Annual Tax),
// Blake Example (in review, Bookkeeping) and Casey Demo (declined). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const lead = (n: number) => app(`/leads/0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`);

test('a lead shows who sent it, the answers with the SSN masked, and the files', async ({
  page,
}) => {
  await page.goto(lead(1));
  await expect(page.getByTestId('page-title')).toHaveText('Avery Sample');
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByText('Annual Tax · 2025')).toBeVisible();
  await expect(page.getByText('•••-••-6789')).toBeVisible();
  await expect(page.getByText('123-45-6789')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Other files' })).toBeVisible();

  const files = page.getByTestId('lead-file');
  await expect(files).toHaveCount(1);
  await expect(files).toContainText('sample-w2.pdf');
  await expect(files.getByRole('button', { name: 'Download sample-w2.pdf' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

test('a declined lead shows the reason, and an unknown lead is not found', async ({ page }) => {
  await page.goto(lead(3));
  await expect(page.getByTestId('page-title')).toHaveText('Casey Demo');
  await expect(page.getByText('Declined', { exact: true })).toBeVisible();
  await expect(page.getByText('Outside the services we offer this season.')).toBeVisible();

  await page.goto(lead(99));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await page.getByRole('link', { name: '← All leads' }).click();
  await expect(page).toHaveURL(/\/leads$/);
});
