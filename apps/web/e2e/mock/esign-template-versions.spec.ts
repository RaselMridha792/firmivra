import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a template lists its versions and can be duplicated', async ({ page }) => {
  await page.goto(app('/firm-sign/templates'));
  await page.getByRole('link', { name: 'Section 7216 Consent' }).click();
  const versions = page.getByTestId('template-versions').getByRole('listitem');
  await expect(versions).toHaveCount(1);
  await expect(versions.first()).toContainText('Version 1');
  await expect(versions.first()).toContainText('Current');
  // The current version can't be restored over itself.
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Duplicate' }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Name of the copy');
  await expect(name).toHaveValue('Copy of Section 7216 Consent');
  await name.fill('Tax Engagement Letter');
  await dialog.getByRole('button', { name: 'Duplicate' }).click();
  await expect(dialog.getByText('Another template already has this name.')).toBeVisible();
  await name.fill('Section 7216 Consent (spouse)');
  await dialog.getByLabel('Who can use it').selectOption('PRIVATE');
  await dialog.getByRole('button', { name: 'Duplicate' }).click();

  await expect(page.getByTestId('page-title')).toHaveText('Section 7216 Consent (spouse)');
  await expect(page.getByText('Only its owner')).toBeVisible();
});
