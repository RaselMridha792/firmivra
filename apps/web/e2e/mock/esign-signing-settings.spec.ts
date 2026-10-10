import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an Owner changes the defaults; a reminder after the expiry is refused', async ({ page }) => {
  await page.goto(app('/firm-sign/settings'));
  await expect(page.getByTestId('page-title')).toHaveText('Signing settings');
  const save = page.getByRole('button', { name: 'Save defaults' });
  await expect(save).toBeDisabled();

  // Reminders on days 3, 6 and 9: the last one would pass a 9-day expiry.
  await page.getByLabel('Expires after (days)').fill('9');
  await save.click();
  await expect(page.getByText('The last reminder would come on or after the expiry')).toBeVisible();
  await page.getByLabel('Expires after (days)').fill('400');
  await save.click();
  await expect(page.getByText('Enter 1 to 365')).toBeVisible();

  await page.getByLabel('Expires after (days)').fill('45');
  await page.getByLabel('Identity check').selectOption('LINK');
  await save.click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Expires after (days)')).toHaveValue('45');
  await expect(page.getByLabel('Identity check')).toHaveValue('LINK');
});

test('an Owner publishes a new consent version', async ({ page }) => {
  await page.goto(app('/firm-sign/settings'));
  await expect(page.getByTestId('consent-text')).toContainText('Consent to sign electronically');
  await expect(page.getByText(/^Version 1, published/)).toBeVisible();

  await page.getByRole('button', { name: 'Write a new version' }).click();
  const text = page.getByLabel('Consent text');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('This is the text signers accept now.')).toBeVisible();

  await text.fill('Synthetic consent, version two.');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this consent text?' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('consent-text')).toHaveText('Synthetic consent, version two.');
  await expect(page.getByText(/^Version 2, published/)).toBeVisible();
  await page.getByText('Earlier versions').click();
  await expect(page.getByTestId('consent-versions')).toContainText('Version 1');
});

test('a member sets their own job title', async ({ page }) => {
  await page.goto(app('/firm-sign/settings'));
  const save = page.getByRole('button', { name: 'Save job title' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Job title').fill('Senior Preparer');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByLabel('Job title')).toHaveValue('Senior Preparer');
});
