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

test('no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openLibrary(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
