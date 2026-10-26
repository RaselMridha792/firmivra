import { expect, type Page, test } from '@playwright/test';

// Octavia's review of Oct 25, D1 and D3, in mock mode as the Owner: the shared new-client form's
// required fields, and Report a Problem's text. Fake values only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function addClient(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await page.getByTestId('add-client').click();
  return page.getByRole('dialog', { name: 'Add New Client' });
}

test('D1: name, email, phone and the home address are required for an Individual', async ({
  page,
}) => {
  const dialog = await addClient(page);
  for (const label of ['Full name *', 'Email *', 'Phone *', 'Street address *', 'City *']) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText('Home address')).toBeVisible();
  await expect(dialog.getByText(/optional/i)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  for (const message of [
    'Enter a name',
    'Enter an email address',
    'Enter a phone number',
    'Enter the street address',
    'Enter the city',
    'Choose the state',
    'Enter the ZIP code',
  ]) {
    await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  }
  await expect(page).toHaveURL(/\/clients$/);
});

test('D1: a Business gives its Business Name, business contact and business address', async ({
  page,
}) => {
  const dialog = await addClient(page);
  await dialog.getByLabel('Client type').selectOption('BUSINESS');
  for (const label of ['Business name *', 'Business email *', 'Business phone *']) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText('Business address')).toBeVisible();
  await expect(dialog.getByText('Home address')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByText('Enter a name', { exact: true })).toBeVisible();
});

test('D1: each format is checked, and a complete client is created with its address', async ({
  page,
}) => {
  const dialog = await addClient(page);
  await dialog.getByLabel('Client type').selectOption('BUSINESS');
  await dialog.getByLabel('Business name').fill('Fake Bakery LLC');
  await dialog.getByLabel('Business email').fill('not-an-email');
  await dialog.getByLabel('Business phone').fill('12');
  await dialog.getByLabel('Street address').fill('1 Fake Street');
  await dialog.getByLabel('City').fill('Faketown');
  await dialog.getByLabel('State').selectOption('GA');
  await dialog.getByLabel('ZIP code').fill('3030');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByText('Enter a 5-digit ZIP code')).toBeVisible();
  await expect(dialog.getByLabel('Business email')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('Business phone')).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByLabel('Business email').fill('owner@fake-bakery.test');
  await dialog.getByLabel('Business phone').fill('404 555 0100');
  await dialog.getByLabel('ZIP code').fill('30301');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  // The record keeps what the form sent: the business's name, contact and address.
  await expect(page.getByText('Fake Bakery LLC').first()).toBeVisible();
  await expect(page.getByText('owner@fake-bakery.test').first()).toBeVisible();
  await expect(page.getByText('1 Fake Street').first()).toBeVisible();
  await expect(page.getByText(/Faketown,? GA 30301/).first()).toBeVisible();
});

test("D3: Report a Problem says exactly what goes in the report, and sends the page's path only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients?search=fake-search'));
  await page.getByRole('button', { name: 'Help & Support' }).click();
  const report = page.getByRole('link', { name: /Report a Problem/ });
  await expect(report).toContainText(
    'Describe what went wrong. Your firm name and affected page will be included in the report.',
  );
  const href = decodeURIComponent((await report.getAttribute('href')) ?? '');
  expect(href).toContain('Page: /clients');
  expect(href).not.toContain('fake-search');
});
