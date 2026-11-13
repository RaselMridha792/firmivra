import { expect, test } from '@playwright/test';

// R60, Clients E5 (Octavia's Oct 25 review): the client forms' required fields, field by field.
// Add New Client and Edit Details ask for the email, phone and address (a home address for an
// Individual, the business's for a Business), and a Business also for its name and its responsible
// party (full name, email, phone), the person linked to the business, shown on the profile. Mock
// mode as the Owner; client 1 is Jamie Sample, client 2 Acme Widgets LLC (no phone, address or
// responsible party yet). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const acme = '0199b6a1-0000-7000-8000-000000000002';
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-clients-required';

test.describe.configure({ timeout: 180_000 });

test('Add New Client: a Business needs its responsible party', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients?new=1'));
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Client type *').selectOption('BUSINESS');
  await dialog.getByLabel('Business name *').fill('Harbor Fake Co');
  await dialog.getByLabel('Business email *').fill('books@harbor.example.test');
  await dialog.getByLabel('Business phone *').fill('404 555 0180');
  await dialog.getByLabel('Street address *').fill('10 Dock Street');
  await dialog.getByLabel('City *').fill('Savannah');
  await dialog.getByLabel('State *').selectOption('GA');
  await dialog.getByLabel('ZIP code *').fill('31401');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  const party = dialog.getByTestId('responsible-party');
  await expect(party).toContainText("Enter the responsible party's full name");
  await page.screenshot({ path: `${shots}/add-business.png` });
  await party.getByLabel('Full name *').fill('Robin Fake');
  await party.getByLabel('Their email *').fill('robin@harbor.example.test');
  await party.getByLabel('Their phone *').fill('12');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(party).toContainText('Enter the phone number with its country code');
  await party.getByLabel('Their phone *').fill('404 555 0181');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Harbor Fake Co', { timeout: 60_000 });
  const shown = page.getByTestId('responsible-party');
  await expect(shown).toContainText('Robin Fake');
  await expect(shown).toContainText('robin@harbor.example.test');
  await expect(shown).toContainText('(404) 555-0181');
});

test('Edit Details asks for what a Business is missing, field by field', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${acme}`));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Entity type').fill('LLC');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  for (const message of [
    'Enter a phone number',
    'Enter the street address',
    'Enter the city',
    'Choose the state',
    'Enter the ZIP code',
    "Enter the responsible party's full name",
    "Enter the responsible party's email",
    "Enter the responsible party's phone",
  ]) {
    await expect(dialog.getByText(message)).toBeVisible();
  }
  await page.screenshot({ path: `${shots}/edit-business.png`, fullPage: true });
  await dialog.getByLabel('Business phone *').fill('404 555 0190');
  await dialog.getByLabel('Street address *').fill('1 Widget Way');
  await dialog.getByLabel('City *').fill('Atlanta');
  await dialog.getByLabel('State *').fill('GA');
  await dialog.getByLabel('ZIP code *').fill('3030');
  const fields = dialog.getByTestId('responsible-party-fields');
  await fields.getByLabel('Full name *').fill('Casey Fake');
  await fields.getByLabel('Their email *').fill('casey@acme.example.test');
  await fields.getByLabel('Their phone *').fill('404 555 0191');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Enter a 5-digit ZIP code')).toBeVisible();
  await dialog.getByLabel('ZIP code *').fill('30303');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  const shown = page.getByTestId('responsible-party');
  await expect(shown).toContainText('Casey Fake');
  await expect(shown).toContainText('(404) 555-0191');
  await page.screenshot({ path: `${shots}/profile.png` });
});

test("an Individual's email is required and its format checked", async ({ page }) => {
  await page.goto(app(`/clients/${jamie}`));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('responsible-party-fields')).toHaveCount(0);
  await dialog.getByLabel('Email *').fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Enter an email address')).toBeVisible();
  await dialog.getByLabel('Email *').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText(/invalid email/i)).toBeVisible();
});
