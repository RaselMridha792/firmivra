import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';

// R55, Clients Review 2 (G9): a Business linked to its owner's personal profile fills its
// Responsible party from that profile, and only the blank fields. In the mock, Acme Widgets (a
// Business with no responsible party) has Jamie Sample linked as its Owner. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const acme = '0199b6a1-0000-7000-8000-000000000002';
const jamie = clientFixtures()[0]!;

test('Edit details fills the responsible party from the linked owner, blank fields only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${acme}`));

  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog');
  const fields = dialog.getByTestId('responsible-party-fields');
  // What the firm already typed stays.
  await fields.getByLabel('Their phone *').fill('404 555 0199');
  await fields.getByRole('button', { name: `Fill from ${jamie.displayName}` }).click();
  await expect(fields.getByLabel('Full name *')).toHaveValue(/Jamie/);
  await expect(fields.getByLabel('Their email *')).toHaveValue(jamie.email!);
  await expect(fields.getByLabel('Their phone *')).toHaveValue('404 555 0199');
  await expect(fields.getByRole('status')).toContainText(`Filled from ${jamie.displayName}`);
});

test('a Business with no linked person offers no fill', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Northwind Bakery: a Business with no linked profile.
  await page.goto(app('/clients/0199b6a1-0000-7000-8000-000000000006'));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const fields = page.getByRole('dialog').getByTestId('responsible-party-fields');
  await expect(fields.getByLabel('Full name *')).toBeVisible();
  await expect(fields.getByTestId('party-fill')).toHaveCount(0);
});
