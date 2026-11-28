import { expect, test } from '@playwright/test';

// #36 Q24 (I-N01, the lead's (a)), in mock mode: the header plan comes from the catalog's plan
// names and fills line 1 with "Service — Plan" and the service's price, for a service the client
// lacks and for one they have (its own plan preselected). Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a plan for a service the client lacks fills line 1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/new'));
  // Riley Example (fake) has no services yet.
  await page.getByLabel('Client *').selectOption({ label: 'Riley Example' }, { timeout: 60_000 });
  await page
    .getByLabel('Service', { exact: true })
    .selectOption({ label: 'Bookkeeping Services (new for this client)' });
  const plan = page.getByLabel('Plan', { exact: true });
  await expect(plan).toHaveValue('');
  await plan.selectOption('Premium');
  await expect(page.getByLabel('Description 1 *')).toHaveValue('Bookkeeping Services — Premium');
  await expect(page.getByLabel('Rate 1 *')).toHaveValue(/^\d+\.\d{2}$/);
});

test('an enrolled service shows its own plan, and another plan fills line 1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/new'));
  await page.getByLabel('Client *').selectOption({ label: 'Jamie Sample' }, { timeout: 60_000 });
  await page.getByLabel('Service', { exact: true }).selectOption({ label: 'Bookkeeping (Growth)' });
  const plan = page.getByLabel('Plan', { exact: true });
  await expect(plan).toHaveValue('Growth');
  // Preselecting changes no line.
  await expect(page.getByLabel('Description 1 *')).toHaveValue('');
  await plan.selectOption('Starter');
  await expect(page.getByLabel('Description 1 *')).toHaveValue(/ — Starter$/);
  // No plan leaves the line as it is.
  await plan.selectOption('');
  await expect(page.getByLabel('Description 1 *')).toHaveValue(/ — Starter$/);
});
