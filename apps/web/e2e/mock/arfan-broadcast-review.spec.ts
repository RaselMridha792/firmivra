import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const baseUrl = `http://admin.localhost:${port}/communications/broadcasts/new`;
const url = `${baseUrl}/review`;
const sections = ['Basic Information', 'Audience', 'Message Content', 'Schedule'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
});

test('review keeps every frame in data, empty and API-unavailable states', async ({ page }) => {
  for (const state of ['data', 'empty', 'api-unavailable']) {
    await page.goto(`${url}?mockState=${state}`);
    await expect(page).toHaveTitle('Create broadcast: Review & send');
    await expect(page.getByRole('heading', { level: 1, name: 'Create Broadcast' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to message' })).toHaveCount(0);
    const progress = page.getByRole('navigation', { name: 'Broadcast creation progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(4);
    await expect(progress.getByText('Completed:', { exact: true })).toHaveCount(3);
    for (const name of sections)
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Message Preview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send This Broadcast' })).toBeVisible();

    if (state === 'data') {
      await expect(page.getByRole('region', { name: 'Basic Information' })).toContainText(
        'Monthly Newsletter - October 2026',
      );
      await expect(page.getByRole('button', { name: 'Send Now', exact: true })).toBeEnabled();
      await page.getByRole('tab', { name: 'SMS', exact: true }).click();
      await expect(page.getByText('SMS preview', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'In-App', exact: true }).click();
      await expect(page.getByRole('tabpanel')).toContainText('Your Business. Our Priority.');
      await page.getByRole('tab', { name: 'Email', exact: true }).click();
    } else {
      await expect(page.getByTestId(state === 'empty' ? 'page-empty' : 'page-error')).toBeVisible();
      await expect(page.getByRole('tabpanel')).toContainText('No message to preview.');
      await expect(page.getByRole('button', { name: 'Send Now', exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Schedule for Later', exact: true }),
      ).toBeDisabled();
      if (state === 'api-unavailable')
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    }
    await page.screenshot({
      path: test.info().outputPath(`review-${state}-1440.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('review is responsive on tablet and mobile without horizontal overflow', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Send Now', exact: true })).toBeEnabled();
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1024 });
    for (const name of sections)
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`review-data-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('both Message Send Now buttons open review and confirmations remain mock-only', async ({
  page,
}) => {
  for (const index of [0, 1]) {
    await page.goto(`${baseUrl}/message`);
    await page.getByRole('button', { name: 'Send Now', exact: true }).nth(index).click();
    await expect(page).toHaveURL(url);
  }
  await page.getByRole('button', { name: 'Send Now', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This is a mock preview.');
  await dialog.getByRole('button', { name: 'Confirm preview' }).click();
  const sendPanel = page.getByRole('complementary', { name: 'Broadcast preview and sending' });
  await expect(sendPanel.getByRole('status')).toContainText('No messages were sent.');
  await page.getByRole('button', { name: 'Schedule for Later', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm preview' }).click();
  await expect(dialog.getByText('Choose a future date and time.')).toBeVisible();
  await dialog.getByLabel('Date & time').fill('2099-10-20T10:00');
  await dialog.getByRole('button', { name: 'Confirm preview' }).click();
  await expect(sendPanel.getByRole('status')).toContainText('No broadcast has been scheduled.');
  await expect(page.getByRole('region', { name: 'Schedule', exact: true })).toContainText(
    'Scheduled',
  );
});
