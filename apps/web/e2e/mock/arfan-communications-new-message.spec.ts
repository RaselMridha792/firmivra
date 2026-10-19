import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/new`;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
});

test('direct New Message route renders the composer design', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(url);

  await expect(page).toHaveTitle('New message');
  await expect(page.getByRole('heading', { name: 'New Message', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select Recipients' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose Channel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compose Message' })).toBeVisible();
  await expect(page.getByText('Recipient Details', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Now' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Send Now' }).first().click();
  await expect(page.getByRole('status')).toHaveText(
    'Message sending is not connected in this preview.',
  );
  await expect(page).toHaveURL(url);

  for (const recipient of ['Karen Wilson', 'Blue Ridge Consulting (Firm)', 'Team: Onboarding']) {
    await page.getByRole('button', { name: `Remove ${recipient}` }).click();
  }
  await expect(page.getByText('Select a recipient to see their details.')).toBeVisible();
  await expect(page.getByText('No recent activity available.')).toBeVisible();

  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole('heading', { name: 'Compose Message' })).toBeVisible();
  }

  await page.goto(
    `${url.replace('/communications/new', '/communications/broadcasts/new/message')}`,
  );
  await expect(page.getByRole('heading', { name: 'Broadcast Message' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select Recipients' })).toHaveCount(0);
});
