import { expect, test } from '@playwright/test';

// N05 My Profile in mock mode (mocks/clients.ts: the primary login of client 1, Jamie Sample).
// The spouse and authorized views (read-only, name only) are covered by the real-API e2e.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the primary login edits contact details and asks for a name change', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/profile'));
  await expect(page).toHaveTitle('My Profile');
  await expect(page.getByText('Jamie Sample')).toBeVisible();
  await expect(page.getByText('04/12/1985')).toBeVisible();
  await expect(page.getByLabel('Email Address')).toBeDisabled();
  await page.getByLabel('Phone Number').fill('+14045550199');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your changes were saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Request Name Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request Name Change' });
  await dialog.getByLabel('New full name').fill('Jamie Sample-Doe');
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog.getByRole('status')).toContainText('Our team will review');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Request Name Change' }).click();
  await dialog.getByLabel('New full name').fill('Jamie Sample-Doe');
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already with our team');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('link', { name: 'Change my password' })).toHaveAttribute(
    'href',
    '/lvp/forgot-password',
  );
  await expect(page.getByLabel('Account and security by email')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('profile-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('profile-375.png'), fullPage: true });
});
