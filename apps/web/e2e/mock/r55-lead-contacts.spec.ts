import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 8 and R2 9: Edit Lead saves the date of birth, and a
// lead keeps other phones and emails beside its primary ones, shown on Contact Information. In
// mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = (n: number) =>
  `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-${String(n).padStart(12, '0')}`;

test('Edit Lead saves a date of birth and another email, and the card shows them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lead(1));
  const card = page.getByTestId('card-contact');
  await expect(card).toContainText('Work phone');
  await expect(card).toContainText('(404) 555-0199');

  await card.getByRole('button', { name: /Edit/ }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Date of birth').fill('1988-07-14');
  const others = edit.getByTestId('lead-other-contacts');
  await others.getByRole('button', { name: 'Add phone or email' }).click();
  await others.getByLabel('Type').nth(1).selectOption('EMAIL');
  await others.getByLabel('Email', { exact: true }).fill('pat.home@example.test');
  await others.getByLabel('Label (optional)').nth(1).fill('Personal');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();

  await expect(card).toContainText('Personal email');
  await expect(card).toContainText('pat.home@example.test');
  await expect(card).toContainText('Jul 14, 1988');
  await expect(card).toContainText('(404) 555-0199');
});

test('the same email twice is refused on the row', async ({ page }) => {
  await page.goto(lead(1));
  await page.getByTestId('card-contact').getByRole('button', { name: /Edit/ }).click();
  const edit = page.getByRole('dialog');
  const others = edit.getByTestId('lead-other-contacts');
  for (const index of [1, 2]) {
    await others.getByRole('button', { name: 'Add phone or email' }).click();
    await others.getByLabel('Type').nth(index).selectOption('EMAIL');
  }
  await others.getByLabel('Email', { exact: true }).nth(0).fill('same@example.test');
  await others.getByLabel('Email', { exact: true }).nth(1).fill('SAME@example.test');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(others).toContainText('This email is already listed');
  await expect(edit).toBeVisible();
});
