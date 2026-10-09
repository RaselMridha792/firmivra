import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('All requests filtered by a status, a page at a time', async ({ page }) => {
  await page.goto(app('/firm-sign/requests?status=COMPLETED'));
  await expect(page.getByTestId('page-title')).toHaveText('Signature requests');
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
  const rows = page.getByRole('table', { name: 'Signature requests' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('Completed');
  // 42 completed: the first page holds 25, Next shows the rest.
  await expect(rows).toHaveCount(26);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows).toHaveCount(18);
});

test('quick filters on All requests', async ({ page }) => {
  await page.goto(app('/firm-sign/requests'));
  const expiring = page.getByRole('button', { name: 'Expiring soon (2)' });
  await expiring.click();
  await expect(expiring).toHaveAttribute('aria-pressed', 'true');
  // A quick filter stands in for the status filter.
  await expect(page.getByLabel('Status')).toBeDisabled();
  const rows = page.getByRole('table', { name: 'Signature requests' }).getByRole('row');
  await expect(rows).toHaveCount(3);
  // One request waits on this Owner's approval: Sam Staff's Terms of Service.
  await page.getByRole('button', { name: 'Needs my approval (1)' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Terms of Service');
  // Nothing matches a search inside it: the empty state says so.
  await page.getByLabel('Search documents').fill('No such document');
  await expect(page.getByText('No signature requests')).toBeVisible();
});

test('All requests fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/firm-sign/requests'));
  await expect(page.getByRole('table', { name: 'Signature requests' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('a new search goes back to page 1', async ({ page }) => {
  await page.goto(app('/firm-sign/requests?status=COMPLETED'));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2')).toBeVisible();
  await page.getByLabel('Search documents').fill('Engagement');
  await expect(page.getByText('Page 1')).toBeVisible();
});

test('Last 7 Days covers today and the 6 days before', async ({ page }) => {
  // Oct 8: the list starts Oct 2, so the Oct 1 request (8 days) is left out.
  await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
  await page.goto(app('/firm-sign/requests'));
  await page.getByLabel('Last activity').selectOption('7');
  const rows = page.getByRole('table', { name: 'Signature requests' }).getByRole('row');
  await expect(rows).toHaveCount(8);
  // All requests also shows the sender, who it waits on and the expiry.
  for (const name of ['Sender', 'Waiting On', 'Expires']) {
    await expect(page.getByRole('columnheader', { name })).toBeVisible();
  }
});
