import { expect, test } from '@playwright/test';

// R60, Clients Review 2 (G9): Linked Profiles on a client's Overview. Jamie Sample (client 1)
// owns Acme Widgets LLC (client 2): both profiles list the link, each in its own words. Add Link
// finds a client and says how they are linked; Change edits the role; Remove takes the link off
// for both. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const id = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const shots = 'e2e/screenshots/r60-clients-links';

test.describe.configure({ timeout: 180_000 });

test('both profiles list the link; add, change and remove another', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${id(1)}`));
  const card = page.getByTestId('client-links');
  const rows = card.getByTestId('client-link-row');
  await expect(rows.filter({ hasText: 'Acme Widgets LLC (fake)' })).toContainText(
    'Business they own',
    { timeout: 60_000 },
  );

  // Add Link: nothing goes until a client and a role are chosen.
  await page.getByTestId('add-client-link').click();
  const dialog = page.getByRole('dialog', { name: 'Add Link' });
  await dialog.getByRole('button', { name: 'Link Profiles' }).click();
  await expect(dialog).toContainText('Choose the client to link');
  await dialog.getByLabel('Find a client *').fill('Riley');
  await dialog.getByRole('button', { name: /Riley Example/ }).click();
  await expect(dialog.getByTestId('client-link-chosen')).toContainText('Riley Example');
  await dialog.getByRole('combobox').selectOption('SPOUSE');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/add-link.png` });
  await dialog.getByRole('button', { name: 'Link Profiles' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Riley Example is linked to Jamie Sample.')).toBeVisible();
  await expect(rows.filter({ hasText: 'Riley Example' })).toContainText('Spouse');

  // Change, then Remove.
  await card.getByRole('button', { name: 'Change the link to Riley Example' }).click();
  const change = page.getByRole('dialog', { name: 'Change Link' });
  await change.getByRole('combobox').selectOption('FAMILY');
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(rows.filter({ hasText: 'Riley Example' })).toContainText('Family');
  await card.getByRole('button', { name: 'Remove the link to Riley Example' }).click();
  await page
    .getByRole('dialog', { name: 'Remove Link' })
    .getByRole('button', { name: 'Remove Link' })
    .click();
  await expect(rows.filter({ hasText: 'Riley Example' })).toHaveCount(0);

  // The business's own profile reads the link the other way.
  await rows.filter({ hasText: 'Acme Widgets LLC (fake)' }).getByRole('link').click();
  await expect(page.getByTestId('client-links').getByTestId('client-link-row')).toContainText(
    'Owner',
    { timeout: 60_000 },
  );
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/business-side.png` });
});
