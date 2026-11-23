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

test('Intake 1: Require e-signature is a switch that starts off in the builder', async ({
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
  const signature = settings.getByRole('switch', { name: 'Require e-signature' });
  await expect(signature).toBeVisible({ timeout: 60_000 });
  await expect(signature).not.toBeChecked();
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

test('24c-i: an archived template shows in the Archived view, and Restore brings it back as a draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${list}/templates`);
  const cards = page.getByTestId('template-card');
  const first = cards.first();
  const name = ((await first.getByRole('heading').textContent({ timeout: 60_000 })) ?? '').trim();
  await first.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive Template' }).click();
  await expect(cards.filter({ hasText: name })).toHaveCount(0);
  // The Archived view (Status: Archived).
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByLabel('Template status').selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  const archived = cards.filter({ hasText: name });
  await expect(archived).toContainText('Archived');
  await archived.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(`"${name}" was restored as a draft.`)).toBeVisible();
  // Back in the library, as a draft.
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByLabel('Template status').selectOption('');
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(cards.filter({ hasText: name }).first()).toContainText('Draft');
});

test('P4-16: Make a New Link asks first, then gives a new share link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${list}/templates`);
  // A firm-made form, not a service's main form: it has a share link of its own, on in the mock.
  const name = 'Audit Support Intake Form';
  const card = page.getByTestId('template-card').filter({ hasText: name });
  await card.getByRole('button', { name: `Actions for ${name}` }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Share & Publish' }).click();
  const dialog = page.getByTestId('form-share');
  const link = dialog.getByLabel('Link', { exact: true });
  const before = await link.inputValue({ timeout: 60_000 });
  const rotate = dialog.getByTestId('rotate-link');
  await rotate.getByRole('button', { name: 'Make a New Link' }).click();
  await expect(rotate.getByRole('alertdialog', { name: 'Make a new link?' })).toContainText(
    'The current link stops working at once',
  );
  await rotate.getByRole('button', { name: 'Make New Link' }).click();
  await expect(rotate).toContainText('A new link is ready. The old one no longer works.');
  await expect(link).not.toHaveValue(before);
});
