import { expect, test } from '@playwright/test';

// R55, Leads Review Two row 14: Firmivra Mail on a test site. The campaign builder and the results
// say plainly where emails go, so nobody is surprised that a client got nothing. Mock mode
// (mocks/communications.ts, `?mockState=email-held`) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;
const NOTE = 'On this test site, emails go only to your firm’s own team addresses.';

test('the builder and the results say emails go only to the firm’s own team', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new?channel=EMAIL&mockState=email-held`);
  await expect(page.getByTestId('hold-note')).toHaveText(NOTE, { timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath('builder-note.png') });

  // A sent campaign's results, on the same test site.
  await page.goto(base);
  await page.getByRole('tab', { name: 'Sent History' }).click();
  await page.getByRole('link', { name: '2026 Tax Season Reminder' }).click();
  await expect(page.getByTestId('result-kpis')).toBeVisible();
  await page.goto(`${page.url()}?mockState=email-held`);
  await expect(page.getByTestId('hold-note')).toHaveText(NOTE, { timeout: 60_000 });

  // Without the test site's hold, neither says it.
  await page.goto(`${base}/new?channel=EMAIL`);
  await expect(page.getByLabel('Campaign Name')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('hold-note')).toHaveCount(0);
});
