import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** The mock's requests (its fixtures, in the mockup's order). */
const REQUESTS = {
  'Tax Engagement Letter 2026': '0199b6e0-0000-7000-8000-000000000001',
  'Payroll Authorization': '0199b6e0-0000-7000-8000-000000000004',
};

async function open(page: Page, title: keyof typeof REQUESTS) {
  await page.goto(app(`/firm-sign/requests/${REQUESTS[title]}`));
  await expect(page.getByTestId('page-title')).toHaveText(title);
}

test('a completed request: recipients and timeline', async ({ page }) => {
  await open(page, 'Tax Engagement Letter 2026');
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  const recipient = page.getByTestId('recipient');
  await expect(recipient).toHaveCount(1);
  await expect(recipient).toContainText('John Smith');
  await expect(recipient).toContainText('Signed');
  const timeline = page.getByTestId('timeline').getByRole('listitem');
  // Newest first: completed, signed, viewed, sent, created.
  await expect(timeline.first()).toContainText('Completed');
  await expect(timeline.last()).toContainText('Created');
  await expect(page.getByTestId('timeline')).toContainText('Verified by an email code');
});

test('a request part-way through says who it waits on', async ({ page }) => {
  await open(page, 'Payroll Authorization');
  await expect(page.getByText('Waiting for Jordan Brown to sign.')).toBeVisible();
  const recipients = page.getByTestId('recipient');
  await expect(recipients).toHaveCount(2);
  await expect(recipients.first()).toContainText('1. Alex Brown');
  await expect(recipients.nth(1)).toContainText('Viewed');
});

test('request detail fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page, 'Payroll Authorization');
  await expect(page.getByTestId('timeline')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
