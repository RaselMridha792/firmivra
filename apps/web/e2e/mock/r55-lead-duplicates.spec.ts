import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) L13: a second lead for the same person (Begin Online can
// make one) is warned on its Overview with links to the other lead or client; nothing is merged
// (Rasel, Oct 24). In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const shots = 'e2e/mock/r55-screenshots/leads';

test('the Overview warns of a lead with the same email and links to it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Twin');
  await dialog.getByLabel('Last name').fill('Fakeperson');
  await dialog.getByRole('textbox', { name: 'Email' }).fill('bruno.sandoval@example.test');
  await dialog.getByLabel('Assigned staff').selectOption({ label: 'Hana Kim' });
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await dialog
    .getByLabel('Create this lead anyway if the matching email or phone is correct')
    .check();
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);

  const table = page.getByRole('table', { name: 'Leads' });
  await table
    .getByRole('row', { name: /Twin Fakeperson/ })
    .getByRole('link')
    .first()
    .click();
  const warning = page.getByTestId('lead-duplicates');
  await expect(warning).toContainText('Possible duplicate');
  await expect(warning.getByRole('link', { name: 'Bruno Sandoval (lead)' })).toHaveAttribute(
    'href',
    /^\/leads\//,
  );
  await page.screenshot({ path: `${shots}/lead-duplicates.png` });
});
