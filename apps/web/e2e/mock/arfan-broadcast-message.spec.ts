import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/broadcasts/new/message`;

test('renders the broadcast editor and keeps its layout in empty and API-unavailable states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${url}?mockState=data`);
  await expect(page).toHaveTitle('Create broadcast: Message');
  await expect(page.getByRole('heading', { name: 'Create Broadcast', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Message', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Email' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Channel Preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Message Tools' })).toBeVisible();
  await expect(page.getByText('Select Recipients')).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('broadcast-message-data-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=empty`);
  await expect(page.getByTestId('broadcast-message-step')).toBeVisible();
  await expect(
    page.getByText('No saved message data yet. Start composing your broadcast below.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email Body *' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-message-empty-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=api-unavailable`);
  await expect(page.getByTestId('broadcast-message-step').getByRole('alert')).toContainText(
    "We can't reach Firmivra.",
  );
  await expect(page.getByRole('heading', { name: 'Channel Preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Message Tools' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('broadcast-message-api-unavailable-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });
});

test('keeps the broadcast message layout within a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);

  await expect(page.getByRole('heading', { name: 'Create Broadcast', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Email' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Channel Preview' })).toBeVisible();
  const step = page.getByTestId('broadcast-message-step');
  const saveDraft = step.getByRole('button', { name: 'Save as Draft' });
  const next = step.getByRole('button', { name: 'Next' });
  const back = step.getByRole('button', { name: 'Back', exact: true });
  const buttonBounds = async (locator: typeof saveDraft) =>
    locator.evaluate((element) => {
      const { x, y, width } = element.getBoundingClientRect();
      return { x, y, width };
    });
  const [saveBounds, nextBounds, backBounds] = await Promise.all([
    buttonBounds(saveDraft),
    buttonBounds(next),
    buttonBounds(back),
  ]);
  expect(saveBounds.y).toBeLessThan(nextBounds.y);
  expect(nextBounds.y).toBeLessThan(backBounds.y);
  expect(saveBounds.x).toBe(nextBounds.x);
  expect(nextBounds.x).toBe(backBounds.x);
  expect(saveBounds.width).toBe(nextBounds.width);
  expect(nextBounds.width).toBe(backBounds.width);
  const documentWidth = await page.locator('body').evaluate((element) => element.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: test.info().outputPath('broadcast-message-mobile-375.png'),
    animations: 'disabled',
    fullPage: true,
  });
});
