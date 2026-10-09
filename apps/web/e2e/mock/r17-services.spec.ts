import { expect, test } from '@playwright/test';

// N06 My Services in mock mode: one service in each group (mocks/engagements.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('My Services groups the services and takes a cancellation request', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/services'));
  await expect(page).toHaveTitle('My Services');
  const tabs = page.getByRole('tablist', { name: 'Services' });
  await expect(tabs.getByRole('tab', { name: 'Active Services (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText('2025 Personal Tax');
  await page.screenshot({ path: testInfo.outputPath('services-1440.png'), fullPage: true });

  await tabs.getByRole('tab', { name: /^Recurring/ }).click();
  const card = page.getByTestId('service-card').filter({ hasText: 'Bookkeeping' });
  await card.getByRole('button', { name: 'Request cancellation' }).click();
  await card.getByLabel('Reason (optional)').fill('Moving the books in-house.');
  await card.getByRole('button', { name: 'Send request' }).click();
  await expect(card.getByRole('status')).toContainText('Cancellation requested');
  await expect(card.getByRole('button', { name: 'Request cancellation' })).toHaveCount(0);

  await tabs.getByRole('tab', { name: /^Cancelled/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Documents until');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('services-375.png'), fullPage: true });
});
