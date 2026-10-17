import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://app.localhost:${port}`;
const convertedLeadId = '0199c0c0-0a00-7000-8000-000000000007';
const activeLeadId = '0199c0c0-0a00-7000-8000-000000000001';
const missingLeadId = '0199c0c0-0a00-7000-8000-000000000999';

test('shows the completed conversion and all five follow-up details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/leads/${convertedLeadId}/convert/done?inviteSent=false`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveTitle('Convert lead: Complete');
  await expect(page.getByRole('heading', { name: 'Lena Brooks is now a client' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Conversion progress' }).getByText('completed'),
  ).toHaveCount(5);
  await expect(page.getByTestId('after-conversion-card').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'View Client' })).toHaveAttribute(
    'href',
    '/clients/0199c0c0-1c00-7000-8000-000000000007',
  );
  await expect(page.getByRole('button', { name: 'Send portal invitation' })).toBeDisabled();
  await page.screenshot({
    path: test.info().outputPath('convert-step-5-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: 'Lena Brooks is now a client' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: test.info().outputPath('convert-step-5-mobile.png'),
    fullPage: true,
  });
});

test('keeps the completion frames when the lead has not been converted', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/leads/${activeLeadId}/convert/done`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('conversion-result')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No completed conversion found' })).toBeVisible();
  await expect(page.getByTestId('after-conversion-card')).toBeVisible();
  await expect(page.getByTestId('after-conversion-card')).toContainText(
    'After conversion details are not available for this lead.',
  );
  await expect(page.getByRole('button', { name: 'View Client' })).toBeDisabled();
  await page.screenshot({
    path: test.info().outputPath('convert-step-5-empty.png'),
    fullPage: true,
  });
});

test('keeps the completion frames when the profile cannot be found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/leads/${missingLeadId}/convert/done`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.getByRole('heading', { name: 'Conversion details are unavailable' }),
  ).toBeVisible();
  await expect(page.getByTestId('conversion-result')).toBeVisible();
  await expect(page.getByTestId('after-conversion-card')).toContainText(
    'After conversion details are not available for this lead.',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Leads' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('convert-step-5-api-error.png'),
    fullPage: true,
  });
});
