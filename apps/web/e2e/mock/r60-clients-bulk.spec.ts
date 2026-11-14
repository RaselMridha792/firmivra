import { expect, test, type Page } from '@playwright/test';

// R60, Clients Bulk Actions (Octavia's E2 additions): beyond Assign, Archive and Restore, the
// chosen clients get Add Tag, Change Status, Mark Inactive (Change Status with Inactive chosen)
// and Export Selected. Each dialog names the clients first and waits for its choice; the result
// says what changed. Mock mode as the Owner; client 1 Jamie Sample, client 2 Acme Widgets LLC.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const id = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const shots = 'e2e/screenshots/r60-clients-bulk';

test.describe.configure({ timeout: 180_000 });

async function choose(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  for (const n of [1, 2]) {
    await page.getByRole('checkbox', { name: `Select row ${id(n)}` }).check({ timeout: 60_000 });
  }
  await expect(page.getByText('2 clients selected')).toBeVisible();
}

async function bulk(page: Page, item: string) {
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('Add Tag and Mark Inactive name the clients, wait for the choice, then say what changed', async ({
  page,
}) => {
  await choose(page);
  await bulk(page, 'Add Tag');
  let dialog = page.getByRole('dialog', { name: 'Add Tag' });
  await expect(dialog).toContainText('Jamie Sample');
  await expect(dialog).toContainText('Acme Widgets LLC (fake)');
  const add = dialog.getByRole('button', { name: 'Add Tag' });
  await expect(add).toBeDisabled();
  await dialog.getByLabel('Tag').selectOption({ index: 1 });
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/add-tag.png` });
  await add.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/2 clients tagged/)).toBeVisible();

  await choose(page);
  await bulk(page, 'Mark Inactive');
  dialog = page.getByRole('dialog', { name: 'Change Status' });
  await expect(dialog.getByLabel('New status')).toHaveValue('INACTIVE');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/mark-inactive.png` });
  await dialog.getByRole('button', { name: 'Change Status' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/2 clients updated/)).toBeVisible();
  await page
    .getByRole('tablist', { name: 'Client views' })
    .getByRole('tab', { name: /Inactive/ })
    .click();
  const names = page.getByTestId('clients-table').getByTestId('client-link');
  await expect(names).toContainText(['Jamie Sample']);
  await expect(names).toContainText(['Acme Widgets LLC (fake)']);
});

test('Export Selected exports only the clients chosen', async ({ page }) => {
  await choose(page);
  await bulk(page, 'Export Selected');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toContainText('the 2 clients you selected');
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole('button', { name: 'Export 2 clients' }).click();
  await expect(page.getByText('Exported 2 clients.')).toBeVisible();
});
