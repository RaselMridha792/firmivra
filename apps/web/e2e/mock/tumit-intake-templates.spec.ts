import { expect, type Page, test } from '@playwright/test';

// Intake Forms > Form Templates (/intake-forms/templates) in mock mode (playwright.mock.config.ts,
// the intakeForms mock, as the Owner). Synthetic data only: the mock's eight starter templates.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openLibrary(page: Page) {
  await page.goto(app('/intake-forms/templates'));
  await expect(page).toHaveTitle('Form templates');
  await expect(page.getByTestId('template-card')).toHaveCount(8, { timeout: 60_000 });
}

test('shows the numbers, the eight template cards and the side frames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openLibrary(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Form Templates' })).toBeVisible();
  await expect(page.getByTestId('kpi-total')).toContainText('8');
  await expect(page.getByTestId('kpi-total')).toContainText('Total Templates');
  await expect(page.getByTestId('kpi-most-used')).toContainText('Most Used');
  await expect(page.getByTestId('kpi-custom')).toContainText('3');
  await expect(page.getByTestId('kpi-updated')).toContainText('Recently Updated');

  const card = page.getByTestId('template-card').filter({ hasText: 'Personal Tax Intake Form' });
  await expect(card).toContainText('42 questions');
  await expect(card).toContainText('156 times');
  await expect(card.getByRole('button', { name: 'Use Template' })).toBeVisible();

  await expect(page.getByTestId('template-categories')).toContainText('Personal Tax');
  await expect(page.getByTestId('recently-used')).toContainText('Used 3 days ago');
  await expect(page.getByTestId('template-quick-actions')).toContainText('Duplicate Template');
});

test('the Business Tax tab and the search filter the library', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('tab', { name: 'Business Tax' }).click();
  await expect(page.getByTestId('template-card')).toHaveCount(1);
  await expect(page.getByTestId('template-card')).toContainText('Business Tax Intake Form');

  await page.getByRole('tab', { name: 'All Templates' }).click();
  await expect(page.getByTestId('template-card')).toHaveCount(8);
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('payroll');
  await expect(page.getByTestId('template-card')).toHaveCount(1);
  await expect(page.getByTestId('template-card')).toContainText('Payroll Setup Form');

  await page.getByRole('searchbox', { name: 'Search templates' }).fill('no such template');
  await expect(page.getByTestId('template-card')).toHaveCount(0);
  await expect(page.getByText('No templates match this search or category.')).toBeVisible();
});

test('Preview shows the sections without sending, and Use Template opens Send', async ({
  page,
}) => {
  await openLibrary(page);
  const card = page.getByTestId('template-card').filter({ hasText: 'Personal Tax Intake Form' });
  await card.getByRole('button', { name: 'Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal Tax Intake Form' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('template-preview')).toContainText('Personal Information');
  await expect(dialog.getByTestId('template-preview')).toContainText('Income Information');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await card.getByRole('button', { name: 'Use Template' }).click();
  await expect(page).toHaveURL(/\/intake-forms\/send\?formId=[0-9a-f-]{36}$/);
});

// Octavia's review of Oct 20 (I1): a duplicate stays in the library as a draft, counted in the
// numbers, and a draft is published before it is sent.
test('a duplicate stays in the library as a draft and in the numbers', async ({ page }) => {
  await openLibrary(page);
  const card = page.getByTestId('template-card').filter({ hasText: 'Payroll Setup Form' });
  await card.getByRole('button', { name: 'Actions for Payroll Setup Form' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(
    page.getByText('"Payroll Setup Form (Copy)" was added as a draft template.'),
  ).toBeVisible();
  await expect(page.getByTestId('template-card')).toHaveCount(9);
  await expect(page.getByTestId('kpi-total')).toContainText('9');
  const copy = page.getByTestId('template-card').filter({ hasText: 'Payroll Setup Form (Copy)' });
  await expect(copy).toContainText('Draft');
  await expect(copy.getByRole('button', { name: 'Use Template' })).toBeDisabled();
  await expect(copy).toContainText('Publish this template before sending it');
});

test('Create Template asks for the service, then opens the builder', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('tab', { name: 'Payroll' }).click();
  await page.getByRole('button', { name: 'Create Template' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Template' });
  await expect(dialog.getByLabel('Service')).toHaveValue(/[0-9a-f-]{36}/);
  await expect(dialog.getByLabel('Service')).toContainText('Payroll service (Payroll)');
  await dialog.getByRole('button', { name: 'Create Template' }).click();
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/, { timeout: 60_000 });
});

test('says which built-in form is missing when its category has none', async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByTestId('missing-service-forms')).toHaveCount(0);
  const card = page.getByTestId('template-card').filter({ hasText: 'Payroll Setup Form' });
  await card.getByRole('button', { name: 'Actions for Payroll Setup Form' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page
    .getByRole('dialog', { name: 'Archive template?' })
    .getByRole('button', { name: 'Archive Template' })
    .click();
  await expect(page.getByTestId('missing-service-forms')).toContainText(
    'The built-in Payroll form appears here once your firm offers that service.',
  );
  await expect(
    page
      .getByTestId('missing-service-forms')
      .getByRole('link', { name: 'Open Services & Pricing' }),
  ).toHaveAttribute('href', '/services-pricing');
});

test('no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openLibrary(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
