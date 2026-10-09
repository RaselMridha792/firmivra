import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const COMPLETED = '0199b6e0-0000-7000-8000-000000000001';

test('save a request as a template, then open it', async ({ page }) => {
  await page.goto(app(`/firm-sign/requests/${COMPLETED}`));
  await page.getByRole('button', { name: 'Save as template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  const name = dialog.getByLabel('Template name');
  await expect(name).toHaveValue('Tax Engagement Letter 2026');

  await name.fill('');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog.getByText('Name the template')).toBeVisible();
  // A mock fixture already has this name.
  await name.fill('Bookkeeping Services Agreement');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog.getByText('Another template already has this name.')).toBeVisible();

  await name.fill('Engagement Letter (synthetic)');
  await dialog.getByLabel('Description (optional)').fill('Synthetic description.');
  await dialog.getByLabel('Who can use it').selectOption('PRIVATE');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Engagement Letter (synthetic) is saved as a template.',
  );
  await expect(dialog.getByRole('link', { name: 'Open the template' })).toHaveAttribute(
    'href',
    /^\/firm-sign\/templates\/[0-9a-f-]{36}$/,
  );
});
