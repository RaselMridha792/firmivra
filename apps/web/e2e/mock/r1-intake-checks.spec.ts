import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two check (Nov 17): the rows whose behaviour was built but untested.
// Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const list = `http://app.localhost:${port}/intake-forms`;

test.describe.configure({ timeout: 180_000 });

test('17c: a form made from scratch opens blank in the builder', async ({ page }) => {
  await page.goto(list);
  await page.getByRole('button', { name: 'Create Intake Form', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Intake Form' });
  const service = dialog.getByLabel('Service');
  const first = await service.locator('option').nth(1).getAttribute('value');
  await service.selectOption(first ?? '');
  await dialog.getByRole('button', { name: 'Create Intake Form', exact: true }).click();
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(
    page.getByText('No sections yet. Add a section, then add questions from Add Questions.'),
  ).toBeVisible({ timeout: 60_000 });
});

test('INTAKE-USABILITY-01: More Filters names the sent dates "Date Sent: From" and "To", visibly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(list);
  await page.getByRole('button', { name: 'More Filters' }).click({ timeout: 60_000 });
  await expect(page.getByText('Date Sent: From', { exact: true })).toBeVisible();
  await expect(page.getByText('To', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Date Sent: From')).toHaveAttribute('type', 'date');
  await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('type', 'date');
});

test('INTAKE-USABILITY-02: the search and its results come back after opening a form and the breadcrumb', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(list);
  const table = page.getByRole('table').first();
  const forms = (t = table) => t.locator('a[href^="/intake-forms/"]');
  const firstForm = forms().first();
  const name = (await firstForm.textContent({ timeout: 60_000 }))?.trim() ?? '';
  expect(name).not.toBe('');
  const all = await forms().count();
  const search = page.getByLabel('Search forms');
  await search.fill(name);
  // The search narrows the list (it waits for the typing to pause).
  await expect.poll(() => forms().count(), { timeout: 30_000 }).toBeLessThan(all);
  await expect(forms().filter({ hasText: name }).first()).toBeVisible();
  const shown = await forms().count();
  await forms().filter({ hasText: name }).first().click();
  await expect(page).toHaveURL(/\/intake-forms\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', {
      name: 'Intake Forms',
    })
    .click();
  await expect(page).toHaveURL(list);
  await expect(page.getByLabel('Search forms')).toHaveValue(name);
  await expect(forms(page.getByRole('table').first())).toHaveCount(shown);
});

test('23-h: Require e-signature is always on in the builder’s Form Settings, with why', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(list);
  await page.getByRole('button', { name: 'Create Intake Form', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Intake Form' });
  const service = dialog.getByLabel('Service');
  await service.selectOption((await service.locator('option').nth(1).getAttribute('value')) ?? '');
  await dialog.getByRole('button', { name: 'Create Intake Form', exact: true }).click();
  const settings = page.getByTestId('form-settings');
  await expect(settings.getByTestId('signature-always-on')).toContainText(
    'Require e-signature: Always on',
    { timeout: 60_000 },
  );
  await expect(settings).toContainText(
    "Always on: each submission signs your firm's agreements, which keeps a legal record.",
  );
  await expect(settings.getByRole('switch', { name: 'Require e-signature' })).toHaveCount(0);
  // The other switches stay, Allow file uploads and Show progress bar among them.
  for (const name of ['Allow file uploads', 'Show progress bar'])
    await expect(settings.getByRole('switch', { name })).toBeVisible();
});

test('23-g: a numbered form shows its Submission ID on its record', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(list);
  await page
    .getByRole('table')
    .first()
    .locator('a[href^="/intake-forms/"]')
    .first()
    .click({ timeout: 60_000 });
  await expect(page.getByTestId('submission-id')).toHaveText(/^Submission ID SUB-\d{5}$/, {
    timeout: 60_000,
  });
});
