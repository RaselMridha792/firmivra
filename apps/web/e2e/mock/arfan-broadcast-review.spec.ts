import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const baseUrl = `http://admin.localhost:${port}/communications/broadcasts/new`;
const url = `${baseUrl}/review`;
const sections = ['Basic Information', 'Audience', 'Message Content', 'Schedule'];
// R56: drafts of the contract mock, carried as ?id= (Application Follow Up, Share Your Feedback).
const draftId = '0199c3a0-0000-7000-8101-000000000004';
const otherDraftId = '0199c3a0-0000-7000-8101-000000000012';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
});

test('review keeps every frame with a draft and without one', async ({ page }) => {
  for (const state of ['data', 'empty']) {
    await page.goto(state === 'data' ? `${url}?id=${draftId}` : url);
    await expect(page).toHaveTitle('Create broadcast: Review & send');
    await expect(page.getByRole('heading', { level: 1, name: 'Create Broadcast' })).toBeVisible();
    const progress = page.getByRole('navigation', { name: 'Broadcast creation progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(4);
    await expect(progress.getByText('Completed:', { exact: true })).toHaveCount(3);
    for (const name of sections)
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Message Preview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send This Broadcast' })).toBeVisible();

    if (state === 'data') {
      await expect(page.getByRole('region', { name: 'Basic Information' })).toContainText(
        'Application Follow Up',
      );
      await expect(page.getByRole('button', { name: 'Send Now', exact: true })).toBeEnabled();
      // An SMS-only broadcast: the preview opens on its SMS tab.
      await expect(page.getByRole('tab', { name: 'SMS', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByRole('tabpanel').getByText('SMS preview', { exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByText('No broadcast to review yet.', { exact: false })).toBeVisible();
      await expect(page.getByRole('tabpanel')).toContainText('No message to preview.');
      await expect(page.getByRole('button', { name: 'Send Now', exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Schedule for Later', exact: true }),
      ).toBeDisabled();
    }
    await page.screenshot({
      path: test.info().outputPath(`review-${state}-1440.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('review is responsive on tablet and mobile without horizontal overflow', async ({ page }) => {
  await page.goto(`${url}?id=${draftId}`);
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

test('schedules a draft and sends another through the contract', async ({ page }) => {
  await page.goto(`${url}?id=${draftId}`);
  await page.getByRole('button', { name: 'Schedule for Later', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog.getByText('Choose a future date and time.')).toBeVisible();
  await dialog.getByLabel('Date & time').fill('2099-10-20T10:00');
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(`http://admin.localhost:${port}/communications/broadcasts`);

  await page.goto(`${url}?id=${otherDraftId}`);
  await page.getByRole('button', { name: 'Send Now', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('It cannot be stopped once it starts.');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Now', exact: true }).click();
  await expect(page).toHaveURL(`http://admin.localhost:${port}/communications/broadcasts`);
});
