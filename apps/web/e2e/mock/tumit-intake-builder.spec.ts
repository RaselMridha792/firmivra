import { expect, test } from '@playwright/test';

// Intake Forms > Create New Intake Form (/intake-forms/builder/[formId]) in mock mode
// (playwright.mock.config.ts runs every module on mock data as an Owner). The seeded forms are
// published templates; template 1 (Personal Tax Intake Form) has five sections.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const TEMPLATE = '0199c0d0-0f00-7000-8000-000000000001';
const builder = (id = TEMPLATE) => `http://app.localhost:${port}/intake-forms/builder/${id}`;
const SECTIONS: [string, string][] = [
  ['Personal Information', '5 questions'],
  ['Address Information', '3 questions'],
  ['Income Information', '6 questions'],
  ['Deductions & Credits', '5 questions'],
  ['Document Uploads', '2 questions'],
];

test('a template opens with its sections and question counts, and fits a 375 px screen', async ({
  page,
}) => {
  await page.goto(builder());
  const sections = page.getByTestId('form-section');
  await expect(sections).toHaveCount(SECTIONS.length);
  for (const [i, [title, count]] of SECTIONS.entries()) {
    await expect(sections.nth(i)).toContainText(title);
    await expect(sections.nth(i).getByTestId('section-count')).toHaveText(count);
  }
  for (const card of ['form-details', 'build-your-form', 'add-questions', 'form-settings']) {
    await expect(page.getByTestId(card)).toBeVisible();
  }
  await expect(page.getByLabel('Form Name')).toHaveValue('Personal Tax Intake Form');
  const tabs = page.getByRole('navigation', { name: 'Build Your Form' });
  await expect(tabs.getByRole('link')).toHaveText(['Form Builder', 'Preview', 'Logic & Rules']);
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Form Builder');
  await expect(page.getByTestId('add-questions').getByRole('button')).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Add New Section' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: 'Publish Form' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('a question tile adds its question to the chosen section', async ({ page }) => {
  await page.goto(builder());
  const address = page.getByTestId('form-section').filter({ hasText: 'Address Information' });
  const choose = address.locator('button[aria-pressed]');
  await choose.click();
  await expect(choose).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('add-target')).toHaveText('Adds to Address Information.');

  await page.getByRole('button', { name: 'Add Short Answer' }).click();
  await expect(address.getByTestId('section-count')).toHaveText('4 questions');
  await expect(address.getByTestId('form-question')).toHaveCount(4);
  await expect(address.getByTestId('form-question').last()).toContainText('New question');
  // A Section Break organises the form: it is listed but not counted as a question.
  await page.getByRole('button', { name: 'Add Section Break' }).click();
  await expect(address.getByTestId('form-question')).toHaveCount(5);
  await expect(address.getByTestId('section-count')).toHaveText('4 questions');
  await expect(page.getByTestId('form-section').first().getByTestId('section-count')).toHaveText(
    '5 questions',
  );
  await expect(page.getByTestId('builder-status')).toHaveText('Unsaved changes');
});

test('Save as Draft on a published template saves a new draft copy and moves to it', async ({
  page,
}) => {
  await page.goto(builder());
  const name = page.getByLabel('Form Name');
  await expect(name).toHaveValue('Personal Tax Intake Form');
  await name.fill('Personal Tax Intake Form 2026');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('builder-status')).toHaveText(
    'Saved as a new draft. The published form is unchanged.',
  );
  await expect(page).not.toHaveURL(new RegExp(TEMPLATE));
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Create Form Template' })).toBeVisible();
  await expect(name).toHaveValue('Personal Tax Intake Form 2026');
  await expect(page.getByTestId('form-section')).toHaveCount(SECTIONS.length);
});

test('an empty Form Name blocks Publish Form with the field error', async ({ page }) => {
  await page.goto(builder());
  const name = page.getByLabel('Form Name');
  await expect(name).toHaveValue('Personal Tax Intake Form');
  await name.fill('');
  await page.getByRole('button', { name: 'Publish Form' }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('form-details').getByText('Enter a form name')).toBeVisible();
  await expect(page.getByTestId('builder-status')).toHaveText(
    'Check the highlighted items, then save again.',
  );
  await expect(page).toHaveURL(new RegExp(`${TEMPLATE}$`));

  // The error goes as soon as the name is back.
  await name.fill('Personal Tax Intake Form');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('builder-status')).not.toHaveText(/highlighted/);
});
