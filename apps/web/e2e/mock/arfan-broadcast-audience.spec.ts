import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/broadcasts/new/audience`;
// R56: a draft of the contract mock (Application Follow Up, SMS), carried as ?id=.
const draftId = '0199c3a0-0000-7000-8101-000000000004';

test('lists the saved segments, counts the chosen one and saves it on the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${url}?id=${draftId}`);
  await expect(page).toHaveTitle('Create broadcast: Audience');
  await expect(page.getByRole('heading', { name: 'Create Broadcast', level: 1 })).toBeVisible();

  const table = page.getByTestId('audience-segments');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody')).toContainText('All Firms');
  await expect(table.locator('tbody tr')).toHaveCount(8);
  await expect(page.getByText('recipients selected')).toBeVisible();
  await expect(page.getByText('Broadcast Summary')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-audience-data-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.locator('footer').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(
    `http://admin.localhost:${port}/communications/broadcasts/new/message?id=${draftId}`,
  );
});

test('says where to start without a broadcast, and keeps the frame', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page.getByText('No audience selected')).toBeVisible();
  await page.getByTestId('audience-segments').locator('tbody input[type=checkbox]').first().check();
  await page.locator('footer').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByText('Start the broadcast with its basic information first.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audience', level: 2 })).toBeVisible();
  await expect(page.getByText('Audience Tips')).toBeVisible();
});

test('keeps the audience page responsive at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);

  await expect(page.getByRole('tab', { name: 'Saved Segments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create New Segment' })).toBeVisible();
  await expect(page.getByTestId('audience-segments')).toBeVisible();
  await expect(page.getByText('Broadcast Summary')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-audience-mobile-375.png'),
    animations: 'disabled',
    fullPage: true,
  });
});
