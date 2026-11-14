import { expect, test } from '@playwright/test';

// R60, Clients Review 2 (G11): the client's Overview shows Billing from the client's invoices:
// open invoices, balance due, overdue and the last invoice paid, with View Invoices into the
// client's Invoices. Mock mode as the Owner; client 1 is Jamie Sample. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-clients-billing';

test.describe.configure({ timeout: 180_000 });

test('Overview shows the billing figures and opens the client invoices', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${jamie}`));
  const card = page.getByTestId('client-billing');
  for (const label of ['Open invoices', 'Balance due', 'Overdue', 'Last invoice paid']) {
    await expect(card.getByText(label, { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  await expect(card.getByText(/^\$[\d,]+\.\d{2}$/).first()).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/overview-billing.png` });

  await page.getByRole('link', { name: 'View Invoices' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${jamie}/invoices$`));
});

test('Billing fits a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app(`/clients/${jamie}`));
  await expect(page.getByTestId('client-billing').getByText('Balance due')).toBeVisible({
    timeout: 60_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
