import { expect, test } from '@playwright/test';

// Leads (Add New Lead): a possible duplicate is asked about in words, never "Something went
// wrong", and ticking "Create this lead anyway" saves it. Mock mode (playwright.mock.config.ts) as
// the Owner; the mock answers POSSIBLE_DUPLICATE for taken@example.test, as the API does.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('a possible duplicate says what matched and how to go on, then saves when ticked', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Dana');
  await dialog.getByLabel('Last name').fill('Matchfake');
  await dialog.getByRole('textbox', { name: 'Email' }).fill('taken@example.test');
  await dialog.getByRole('button', { name: 'Save Lead' }).click();

  await expect(dialog.getByRole('alert')).toHaveText(
    'A lead or client already has this email or phone. Check it, or tick "Create this lead anyway" to add it.',
  );
  await expect(dialog.getByText('Something went wrong')).toHaveCount(0);
  await dialog
    .getByLabel('Create this lead anyway if the matching email or phone is correct')
    .check();
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('table', { name: 'Leads' }).getByRole('row', { name: /Dana Matchfake/ }),
  ).toHaveCount(1);
});
