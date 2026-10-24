import { expect, type Page, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L10: Archived Leads under More Filters shows the
// archived leads, read-only, with Restore per record and in the bulk bar; a restored lead comes
// back with its status. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
const row = (page: Page, name: string) => table(page).getByRole('row', { name: new RegExp(name) });

async function archive(page: Page, name: string) {
  await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(row(page, name)).toHaveCount(0);
}

async function showArchived(page: Page) {
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByLabel('Archived leads').check();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Archived filter')).toContainText('Archived Leads');
}

test('an archived lead is found under Archived Leads and restored as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const status = await row(page, 'Bruno Sandoval').getByRole('cell').nth(6).innerText();
  await archive(page, 'Bruno Sandoval');
  await showArchived(page);
  const archived = row(page, 'Bruno Sandoval');
  await expect(archived).toHaveCount(1);
  // Read-only: no link to a workspace, and Restore is the only action.
  await expect(archived.getByRole('link')).toHaveCount(0);
  await expect(archived.getByRole('button', { name: /^Call / })).toHaveCount(0);
  await archived.getByRole('button', { name: 'Restore Bruno Sandoval' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'restored' })).toHaveText(
    '1 lead restored, with its status and history.',
  );
  await expect(row(page, 'Bruno Sandoval')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Archived Leads' }).click();
  await expect(row(page, 'Bruno Sandoval').getByRole('cell').nth(6)).toHaveText(status);
});

test('several archived leads are restored from the bulk bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await archive(page, 'Bruno Sandoval');
  await archive(page, 'Selma Shields');
  await showArchived(page);
  for (const name of ['Bruno Sandoval', 'Selma Shields'])
    await row(page, name).getByRole('checkbox').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' }).first();
  await expect(bar.getByRole('button')).toHaveText(['Restore']);
  await bar.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'restored' })).toHaveText(
    '2 leads restored, with their status and history.',
  );
});
