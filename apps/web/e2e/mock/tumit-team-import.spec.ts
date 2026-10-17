import { expect, test } from '@playwright/test';

// Staff Management > Bulk Upload Staff (/team/import), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

const CSV = [
  'First Name,Last Name,Work Email,Role,Department,Shoe Size',
  'Ana,Park,ana.park@example.test,Staff,Tax,7',
  'Ben,Cole,not-an-email,Staff,Tax,9',
  'Hana,Kim,hana.kim@lvp.test,Staff,Payroll,8',
].join('\n');

test('maps, previews and imports a CSV', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/import`);
  await expect(page).toHaveTitle('Bulk upload staff');
  await expect(page.getByRole('link', { name: 'Download CSV Template' })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  });
  const map = page.getByTestId('import-map');
  await expect(map).toContainText('staff.csv: 3 rows');
  // Matching names are mapped; the extra column is left out.
  await expect(map.getByLabel('Work Email')).toHaveValue('email');
  await expect(map.getByLabel('Shoe Size')).toHaveValue('');

  await map.getByLabel('Role').selectOption('');
  await map.getByRole('button', { name: 'Validate & Preview' }).click();
  await expect(map.getByText('Map a column to Role.')).toBeVisible();
  await map.getByLabel('Role').selectOption('role');
  await map.getByRole('button', { name: 'Validate & Preview' }).click();

  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('1New staff to create');
  await expect(preview).toContainText('1Existing staff to update');
  await expect(preview).toContainText('Enter a valid work email');
  await preview.getByRole('button', { name: 'Import 2 Staff' }).click();

  const results = page.getByTestId('import-results');
  await expect(results).toContainText('Import finished');
  await expect(results).toContainText('1Invitations sent');
});

test('refuses a file that is not a CSV', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/import`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('x'),
  });
  await expect(page.getByText('Upload a CSV file.')).toBeVisible();
});
