import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('find a template and open it', async ({ page }) => {
  await page.goto(app('/firm-sign/templates'));
  await expect(page.getByTestId('page-title')).toHaveText('Signing templates');
  const table = page.getByRole('table', { name: 'Signing templates' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await page.getByLabel('Search templates').fill('7216');
  await expect(table.getByRole('row')).toHaveCount(2);
  await table.getByRole('link', { name: 'Section 7216 Consent' }).click();

  await expect(page).toHaveTitle('Signing template');
  await expect(page.getByTestId('page-title')).toHaveText('Section 7216 Consent');
  await expect(page.getByTestId('template-summary')).toContainText('Expires after:30 days');
  await expect(page.getByTestId('template-roles')).toContainText('1. Client (signs');
  await expect(page.getByTestId('template-roles')).toContainText('2. Preparer (signs');
  await expect(page.getByRole('heading', { name: '2 pages, 4 fields' })).toBeVisible();
});

test('rename a template, then archive it', async ({ page }) => {
  await page.goto(app('/firm-sign/templates'));
  await page.getByRole('link', { name: 'Tax Engagement Letter' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Name the template')).toBeVisible();
  await name.fill('Bookkeeping Services Agreement');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Another template already has this name.')).toBeVisible();
  await name.fill('Engagement Letter 2025');
  await page.getByLabel('Who can use it').selectOption('PRIVATE');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Engagement Letter 2025');
  await expect(page.getByText('Only its owner')).toBeVisible();

  await page.getByRole('button', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Archived /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);

  await page.getByRole('link', { name: 'All templates' }).click();
  await expect(page.getByRole('link', { name: 'Engagement Letter 2025' })).toHaveCount(0);
  await page.getByLabel('Show archived').check();
  await expect(page.getByRole('link', { name: 'Engagement Letter 2025' })).toBeVisible();
});

test('a template id that is not one shows Not found', async ({ page }) => {
  await page.goto(app('/firm-sign/templates/tpl-1'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
