// R60, the Client Portal module's Frame 3 (documents-tab.jpg; instructions 18 to 20): Request
// Document with the client chosen, the filters with Clear, the columns, the row menu and 10, 25
// or 50 per page. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Frame 3: Request Document, the filters with Clear, the columns, the row menu and the page size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/documents`));
  const docs = page.getByTestId('portal-documents');
  const table = page.getByTestId('portal-documents-table');
  const names = table.getByTestId('portal-document-name');
  await expect(names.first()).toBeVisible({ timeout: 60_000 });

  for (const column of [
    'Document Name',
    'Type',
    'Category',
    'Source',
    'Uploaded By',
    'Date',
    'Status',
    'Actions',
  ]) {
    await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }

  // Search, then Clear brings every document back.
  const all = await names.count();
  await docs.getByLabel('Search documents').fill('W-2');
  await expect
    .poll(async () => (await names.allInnerTexts()).every((n) => n.includes('W-2')))
    .toBe(true);
  expect(await names.count()).toBeLessThan(all);
  await docs.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(docs.getByLabel('Search documents')).toHaveValue('');
  await expect.poll(() => names.count()).toBe(all);

  // The row menu.
  await table
    .getByRole('button', { name: /^Actions for / })
    .first()
    .click();
  for (const item of [
    'View / Preview',
    'Download',
    'Link to Record',
    'Reclassify',
    'Rename',
    'Archive',
  ]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // 10, 25 or 50 per page.
  const size = docs.getByLabel(/per page/i);
  await expect(size.locator('option')).toHaveText(['10', '25', '50']);
  await size.selectOption('10');
  expect(await names.count()).toBeLessThanOrEqual(10);

  // Request Document opens Documents' request with the client chosen.
  await docs.getByRole('button', { name: 'Request Document' }).click();
  await expect(page).toHaveURL(new RegExp(`clientId=${JAMIE}`));
});
