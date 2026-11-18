import { expect, test } from '@playwright/test';

// R55, Leads Review Two, R61's live check (Nov 18). Row 3: the business or company typed in Add
// New Lead shows on the list, the lead's header, Contact Information and Lead Details, and Edit
// Lead changes it. Mock mode as the Owner; synthetic data.

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const avery = `${base}/leads/0199c0c0-0a00-7000-8000-000000000001`;
const selma = `${base}/leads/0199c0c0-0a00-7000-8000-000000000004`;

test('row 3: the business name shows on the list, header and both cards, and Edit Lead changes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/leads`);
  const row = page.getByRole('row').filter({ hasText: 'Selma Shields' });
  await expect(row).toContainText('Shields Holdings LLC', { timeout: 60_000 });

  await page.goto(selma);
  await expect(page.getByTestId('lead-business')).toHaveText('Shields Holdings LLC', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('card-contact')).toContainText(
    'Business / CompanyShields Holdings LLC',
  );
  await expect(page.getByTestId('card-lead-details')).toContainText(
    'Business / CompanyShields Holdings LLC',
  );

  await page.getByRole('button', { name: 'Edit lead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Lead' });
  const field = dialog.getByLabel('Business / Company name');
  await expect(field).toHaveValue('Shields Holdings LLC');
  await field.fill('Shields Family Bakery (fake)');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('lead-business')).toHaveText('Shields Family Bakery (fake)');
  await expect(page.getByTestId('card-contact')).toContainText('Shields Family Bakery (fake)');
  await expect(page.getByTestId('card-lead-details')).toContainText('Shields Family Bakery (fake)');

  // A lead without one reads a dash, and has no business line under its name.
  await page.goto(avery);
  await expect(page.getByTestId('card-contact')).toContainText('Business / Company—', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('lead-business')).toHaveCount(0);
});
