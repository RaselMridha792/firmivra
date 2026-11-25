import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// R56, Tax Planning resources (audit, Nov 20), in mock mode (playwright.mock.config.ts) as the
// Owner; a reload resets the mock. Add Resource and Create Checklist make the firm's own; every
// resource can be downloaded and printed. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Create Checklist adds the firm’s own; Download saves it with its items; Print is there', async ({
  page,
}) => {
  await page.goto(app('/tax-planning/resources'));
  const list = page.getByTestId('tp-resources');
  await expect(list.getByRole('button', { name: 'Add Resource' })).toBeVisible({ timeout: 60_000 });
  await list.getByRole('button', { name: 'Create Checklist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Checklist' });
  await dialog.getByLabel('Title *').fill('Our document checklist (fake)');
  await expect(dialog.getByLabel('Category *')).toHaveValue('Checklists');
  await dialog.getByLabel('Checklist items').fill('Last year’s return\nW-2 forms');
  await dialog.getByRole('button', { name: 'Save Resource' }).click();
  await expect(page.getByText('Resource added.')).toBeVisible();
  const row = list.getByRole('listitem').filter({ hasText: 'Our document checklist (fake)' });
  await expect(row).toContainText('checklist');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download Our document checklist (fake)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('our-document-checklist-fake.txt');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain('[ ] Last year’s return');
  expect(text).toContain('[ ] W-2 forms');
  await expect(
    row.getByRole('button', { name: 'Print Our document checklist (fake)' }),
  ).toBeVisible();
});

test('Add Resource takes a guide with its content, and a built-in one downloads too', async ({
  page,
}) => {
  await page.goto(app('/tax-planning/resources'));
  const list = page.getByTestId('tp-resources');
  await list.getByRole('button', { name: 'Add Resource' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Add Resource' });
  await dialog.getByLabel('Title *').fill('Our planning guide (fake)');
  await dialog.getByLabel('Category *').fill('Guides');
  await dialog.getByLabel('Content').fill('Plan early in the year.');
  await dialog.getByRole('button', { name: 'Save Resource' }).click();
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Our planning guide (fake)' }),
  ).toBeVisible();

  const builtIn = list.getByRole('listitem').filter({ hasText: 'Retirement Contribution Guide' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    builtIn.getByRole('button', { name: 'Download Retirement Contribution Guide' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('retirement-contribution-guide.txt');
});
