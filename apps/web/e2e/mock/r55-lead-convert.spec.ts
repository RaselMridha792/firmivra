import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item 16 (CHANGE-LIST L9): Convert to Client's fields are
// editable before completion, kept across the steps, and what is sent is what was set. Mock mode
// (playwright.mock.config.ts) as the Owner, on Bruno Sandoval (Personal Tax, Tax Planning).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000003`;

test('edits the client, services, staff, carry-over and invitation, and sends them', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/convert`);
  const fields = page.getByTestId('convert-lead-client-fields');
  await expect(fields.getByLabel('Full Name *')).toHaveValue('Bruno Sandoval');
  const next = page.getByRole('button', { name: /Review & Continue/ });

  // Editable on the first step too; they are checked when Client Details & Services is left.
  await fields.getByLabel('Phone *').fill('');
  await fields.getByRole('radio', { name: 'Business' }).check();
  await fields.getByLabel('Address').fill('12 Fake Street, Springfield');
  await next.click();
  await expect(page).toHaveURL(`${lead}/convert/details`);
  await expect(fields.getByLabel('Address')).toHaveValue('12 Fake Street, Springfield');
  await next.click();
  await expect(fields).toContainText('Enter a phone number.');
  await expect(fields).toContainText('Enter the business name.');
  await expect(page).toHaveURL(`${lead}/convert/details`);
  await fields.getByLabel('Phone *').fill('(555) 030-9999');
  await fields.getByLabel('Business Name *').fill('Sandoval Holdings LLC');
  await fields.getByRole('checkbox', { name: 'Payroll' }).check();
  await fields.getByRole('checkbox', { name: 'Tax Planning' }).uncheck();
  const staff = page.getByTestId('convert-lead-staff-assignment');
  await staff.getByLabel('Primary Staff Member *').selectOption({ label: 'Theo Grant' });
  await staff.getByTestId('team-members').locator('summary').click();
  await staff.getByRole('checkbox', { name: 'Daniel Okafor' }).check();
  await next.click();

  await expect(page).toHaveURL(`${lead}/convert/portal`);
  await page
    .getByTestId('convert-lead-carry-over')
    .getByRole('checkbox', { name: 'Notes' })
    .uncheck();
  await page
    .getByTestId('convert-lead-portal-access')
    .getByRole('radio', { name: /Send later/ })
    .check();
  // Back and forward keeps what was set.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(fields.getByRole('checkbox', { name: 'Payroll' })).toBeChecked();
  await next.click();
  await expect(
    page.getByTestId('convert-lead-portal-access').getByRole('radio', { name: /Send later/ }),
  ).toBeChecked();
  await next.click();

  await expect(page).toHaveURL(`${lead}/convert/review`);
  const summary = page.getByTestId('convert-lead-review-summary');
  for (const text of [
    'Business',
    'Sandoval Holdings LLC',
    '(555) 030-9999',
    '12 Fake Street, Springfield',
    'Personal Tax',
    'Payroll',
    'Theo Grant',
    'Daniel Okafor',
  ])
    await expect(summary).toContainText(text);
  await expect(summary).not.toContainText('Tax Planning');
  const choices = page.getByTestId('convert-lead-review-selections');
  await expect(choices.getByRole('img', { name: 'Not selected: Notes' })).toBeVisible();
  await expect(choices.getByRole('img', { name: 'Selected: Send later' })).toBeVisible();

  await page.getByRole('button', { name: /Convert to Client/ }).click();
  await expect(page).toHaveURL(`${lead}/convert/done`);
});
