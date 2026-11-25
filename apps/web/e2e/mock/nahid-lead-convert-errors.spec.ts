import { expect, test } from '@playwright/test';

// Leads Review Two 17: when the API refuses Convert to Client, the Review step says why and what
// to change, never "Something went wrong". Mock mode (playwright.mock.config.ts) as the Owner, on
// Bruno Sandoval; the mock answers DUPLICATE_EMAIL for taken@example.test, as the API does.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000003`;

test('a refused conversion says why on the Review step and keeps the user there', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/convert`);
  const fields = page.getByTestId('convert-lead-client-fields');
  await expect(fields.getByLabel('Full Name *')).toHaveValue('Bruno Sandoval');
  const next = page.getByRole('button', { name: /Review & Continue/ });

  await fields.getByLabel('Email *').fill('taken@example.test');
  await next.click();
  await expect(page).toHaveURL(`${lead}/convert/details`);
  await page
    .getByTestId('convert-lead-staff-assignment')
    .getByLabel('Primary Staff Member *')
    .selectOption({ label: 'Theo Grant' });
  await next.click();
  await expect(page).toHaveURL(`${lead}/convert/portal`);
  await next.click();
  await expect(page).toHaveURL(`${lead}/convert/review`);

  await page.getByRole('button', { name: 'Convert to Client' }).click();
  const alert = page.getByRole('alert').filter({ hasText: /email/ });
  await expect(alert).toHaveText(
    'Another client already has this email. Change the email in Client Details & Services.',
  );
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page).toHaveURL(`${lead}/convert/review`);
});
