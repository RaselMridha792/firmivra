import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) L12, check C1: her written spec's Preferred column (Rasel,
// Oct 24), between Assigned To and Date Added, with every column still inside the table at
// 1440 px. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows each lead’s preferred contact methods, and the table still fits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const table = page.getByRole('table', { name: 'Leads' });
  await expect(table.getByRole('row', { name: /Bruno Sandoval/ })).toHaveCount(1);
  const headers = (await table.getByRole('columnheader').allInnerTexts())
    .map((h) => h.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  expect(headers.slice(-4)).toEqual(['Assigned To', 'Preferred', 'Date Added', 'Actions']);
  const bruno = table.getByRole('row', { name: /Bruno Sandoval/ });
  await expect(bruno.getByRole('cell').nth(headers.indexOf('Preferred') + 1)).toHaveText(/Email/);
  const fits = await table.evaluate(
    (t) => t.parentElement!.scrollWidth <= t.parentElement!.clientWidth,
  );
  expect(fits).toBe(true);
});
