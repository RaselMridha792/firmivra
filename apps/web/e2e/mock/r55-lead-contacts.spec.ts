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
  await others.getByRole('button', { name: 'Add contact detail' }).click();
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
    await others.getByRole('button', { name: 'Add contact detail' }).click();
    await others.getByLabel('Type').nth(index).selectOption('EMAIL');
  }
  await others.getByLabel('Email', { exact: true }).nth(0).fill('same@example.test');
  await others.getByLabel('Email', { exact: true }).nth(1).fill('SAME@example.test');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(others).toContainText('This email is already listed');
  await expect(edit).toBeVisible();
});

// R2 9: "other relevant contact information": an address, a website and any other detail, beside
// the other phones and emails, saved, shown on Contact Information and kept when Edit reopens.
test('R2 9: Edit Lead adds an address, a website and another detail, and keeps them on the next save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lead(3));
  const card = page.getByTestId('card-contact');
  await card.getByRole('button', { name: /Edit/ }).click();
  const edit = page.getByRole('dialog');
  const others = edit.getByTestId('lead-other-contacts');
  await expect(others).toContainText('Other contact details');
  const add = async (index: number, kind: string, field: string, value: string, label = '') => {
    await others.getByRole('button', { name: 'Add contact detail' }).click();
    await others.getByLabel('Type').nth(index).selectOption(kind);
    await others.getByLabel(field, { exact: true }).fill(value);
    if (label) await others.getByLabel('Label (optional)').nth(index).fill(label);
  };
  await add(0, 'ADDRESS', 'Address', '12 Mock Lane, Springfield', 'Office');
  // A website that is not one is refused on its row, and nothing is saved.
  await add(1, 'WEBSITE', 'Website', 'not a website');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(others).toContainText('Enter a website, for example example.com');
  await expect(edit).toBeVisible();
  await others.getByLabel('Website', { exact: true }).fill('example.test');
  await add(2, 'OTHER', 'Contact detail', '@pat.sample', 'Messaging');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();

  await expect(card).toContainText('Office address');
  await expect(card).toContainText('12 Mock Lane, Springfield');
  await expect(card.getByRole('link', { name: 'example.test' })).toHaveAttribute(
    'href',
    'https://example.test',
  );
  await expect(card).toContainText('Messaging');
  await expect(card).toContainText('@pat.sample');

  // Edit reopens on all three, and saving another field keeps them.
  await card.getByRole('button', { name: /Edit/ }).click();
  await expect(others.getByLabel('Address', { exact: true })).toHaveValue(
    '12 Mock Lane, Springfield',
  );
  await expect(others.getByLabel('Website', { exact: true })).toHaveValue('example.test');
  await expect(others.getByLabel('Contact detail', { exact: true })).toHaveValue('@pat.sample');
  await edit.getByLabel('Best time to contact').fill('Afternoons');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();
  await expect(card).toContainText('Afternoons');
  await expect(card).toContainText('12 Mock Lane, Springfield');
  await expect(card).toContainText('@pat.sample');
});

// R2 8: the card's Edit offers every field the Contact Information card shows, and they save.
test('R2 8: the card Edit saves the address, preferred contact and best time, and reopens on them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lead(2));
  const card = page.getByTestId('card-contact');
  await expect(card).toContainText('Nina Fairbanks');
  await expect(card).toContainText('Phone, Email, SMS');

  await card.getByRole('button', { name: /Edit/ }).click();
  const edit = page.getByRole('dialog');
  const preferred = edit.getByRole('group', { name: 'Preferred contact' });
  await expect(edit.getByLabel('Address', { exact: true })).toBeVisible();
  await expect(preferred.getByRole('checkbox')).toHaveCount(3);
  await expect(edit.getByLabel('Best time to contact')).toBeVisible();
  await expect(edit.getByLabel('Date of birth')).toBeVisible();
  await edit.getByLabel('Address', { exact: true }).fill('45 Sample Road, Austin TX 78701');
  await preferred.getByLabel('Phone').uncheck();
  await preferred.getByLabel('SMS').uncheck();
  await edit.getByLabel('Best time to contact').fill('Weekday mornings');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();

  await expect(card).toContainText('45 Sample Road, Austin TX 78701');
  await expect(card).toContainText('Weekday mornings');
  await expect(card.getByText('Phone, Email, SMS')).toHaveCount(0);
  await expect(card).toContainText(/Preferred Contact\s*Email/);

  await card.getByRole('button', { name: /Edit/ }).click();
  await expect(edit.getByLabel('Address', { exact: true })).toHaveValue(
    '45 Sample Road, Austin TX 78701',
  );
  await expect(preferred.getByLabel('Email')).toBeChecked();
  await expect(preferred.getByLabel('Phone')).not.toBeChecked();
  await expect(preferred.getByLabel('SMS')).not.toBeChecked();
  await expect(edit.getByLabel('Best time to contact')).toHaveValue('Weekday mornings');
});
