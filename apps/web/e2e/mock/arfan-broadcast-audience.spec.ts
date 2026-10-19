import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/broadcasts/new/audience`;

test('keeps the audience layout in data, empty, and API-unavailable states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${url}?mockState=data`);
  await expect(page).toHaveTitle('Create broadcast: Audience');
  await expect(page.getByRole('heading', { name: 'Create Broadcast', level: 1 })).toBeVisible();

  const table = page.getByTestId('audience-segments');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody')).toContainText('All Clients');
  await expect(table.locator('tbody tr')).toHaveCount(8);
  await page.screenshot({
    path: test.info().outputPath('broadcast-audience-data-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=empty`);
  await expect(page.getByTestId('audience-segments')).toBeVisible();
  await expect(page.getByText('No audience segments found.')).toBeVisible();
  await expect(page.getByText('No audience selected')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-audience-empty-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=api-unavailable`);
  await expect(page.getByTestId('audience-segments').getByRole('alert')).toContainText(
    "We couldn't load audience segments. Please try again.",
  );
  await expect(page.getByRole('heading', { name: 'Audience', level: 2 })).toBeVisible();
  await expect(page.getByText('Audience Tips')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-audience-api-unavailable-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });
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
