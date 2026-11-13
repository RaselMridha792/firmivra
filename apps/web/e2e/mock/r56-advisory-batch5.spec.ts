import { expect, test } from '@playwright/test';

// Business Advisory review of Oct 25, batch 5 (Octavia's §10 and §11): B19, Create Appointment
// Type beside the type choice (a new tab, so the draft is kept) and Check again; B20, the Color
// comes from the appointment type, read-only. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('B20: the Color is the appointment type’s, read-only; there is no colour to pick', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  const color = page.getByTestId('appointment-color');
  await expect(color).toHaveValue('Choose a type');
  await expect(color).toHaveAttribute('readonly', '');
  await expect(page.getByRole('combobox', { name: /^Color/ })).toHaveCount(0);
  const type = page.getByLabel('Appointment Type *');
  await type.selectOption({ index: 1 });
  const name = (await type.locator('option:checked').textContent())?.trim() ?? '';
  await expect(color).toHaveAttribute(
    'title',
    `From the appointment type ${name} (Appointments > Types).`,
  );
  await expect(color).not.toHaveValue('Choose a type');
  await page.evaluate(() =>
    document
      .querySelector('[data-testid="appointment-color"]')
      ?.scrollIntoView({ block: 'center' }),
  );
  await page.screenshot({ path: test.info().outputPath('color-from-type.png') });
});

test('B19: Create Appointment Type opens in a new tab and Check again keeps the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  const create = page.getByTestId('create-type');
  const link = create.getByRole('link', { name: 'Create Appointment Type (new tab)' });
  await expect(link).toHaveAttribute('href', '/calendar/types');
  await expect(link).toHaveAttribute('target', '_blank');
  await page.getByLabel('Appointment Type *').selectOption({ index: 1 });
  const chosen = await page.getByLabel('Appointment Type *').inputValue();
  await page.getByLabel('Internal Notes (not visible to client)').fill('Fake: bring the folder.');
  await create.getByRole('button', { name: 'Check again for new types' }).click();
  // Nothing new was made: the choice and the draft stay as they are.
  await expect(page.getByLabel('Appointment Type *')).toHaveValue(chosen);
  await expect(page.getByLabel('Internal Notes (not visible to client)')).toHaveValue(
    'Fake: bring the folder.',
  );
});
