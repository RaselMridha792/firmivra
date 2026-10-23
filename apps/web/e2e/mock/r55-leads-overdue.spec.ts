import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item 2 (CHANGE-LIST L3): the Overdue Follow-Ups card turns
// on a visible filter; past-due follow-ups of open leads are red and counted, and the filter
// combines with a status without changing it. Mock mode (playwright.mock.config.ts), the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

test('the card filters to overdue follow-ups, visibly, and the chip clears it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const card = page.getByRole('button', { name: /Overdue Follow-Ups/ }).first();
  await expect(card).toContainText('2');
  await card.click();
  const chip = page.getByLabel('Active filters').getByText('Overdue Follow-Ups');
  await expect(chip).toBeVisible();
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    const next = row.getByText(/^Overdue:/);
    await expect(next).toBeVisible();
  }
  // Statuses stay what they were: a new lead is still New.
  await expect(rows.filter({ hasText: 'Grace Pruitt' })).toContainText('New Lead');

  await page.getByRole('button', { name: 'Remove Overdue Follow-Ups' }).click();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(rows).not.toHaveCount(2);
});

test('overdue combines with a status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page
    .getByRole('button', { name: /Overdue Follow-Ups/ })
    .first()
    .click();
  await page.getByRole('combobox', { name: 'All Lead Statuses' }).selectOption('SUBMITTED');
  await expect(page.getByLabel('Active filters').getByText('Overdue Follow-Ups')).toBeVisible();
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await page.getByRole('combobox', { name: 'All Lead Statuses' }).selectOption('IN_FOLLOW_UP');
  await expect(page.getByText(/No leads|match/i).first()).toBeVisible();
});
