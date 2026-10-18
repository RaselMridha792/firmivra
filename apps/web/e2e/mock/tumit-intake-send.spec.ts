import { expect, type Page, test } from '@playwright/test';

// Intake Forms > Send Intake Form (/intake-forms/send) in mock mode (playwright.mock.config.ts:
// every module on mock data, as an Owner). Synthetic people only: the clients, leads, team and
// intake forms mocks.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PERSONAL_TAX = '0199c0d0-0f00-7000-8000-000000000001';

async function open(page: Page, path = '/intake-forms/send') {
  await page.goto(app(path));
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible();
}

const summaryRow = (page: Page, label: string) =>
  page.getByTestId('send-summary').locator('div').filter({ hasText: label });

test('send a form to a client by email and see the result', async ({ page }) => {
  await open(page);
  for (const id of ['send-recipient', 'send-form', 'send-delivery', 'send-message', 'send-review'])
    await expect(page.getByTestId(id)).toBeVisible();

  await page.getByRole('button', { name: /^Client/ }).click();
  await page.getByRole('option', { name: /Jamie Sample/ }).click();
  await page
    .getByRole('combobox', { name: /Form \/ Template/ })
    .selectOption({ label: 'Personal Tax Intake Form' });
  await expect(page.getByTestId('send-form-card')).toContainText('42 questions');
  await page.getByRole('radio', { name: /^Email/ }).check();
  await page.getByRole('textbox', { name: /^Subject/ }).fill('Your Personal Tax Intake Form');
  await page
    .getByRole('textbox', { name: /^Message/ })
    .fill('Hi Jamie,\n\nPlease complete your intake form when you can.\n\nThank you');

  await expect(page.getByText('Ready to Send')).toBeVisible();
  await page.getByRole('button', { name: 'Send Form' }).click();

  const result = page.getByTestId('send-result');
  await expect(result).toContainText('Form Sent');
  await expect(result).toContainText('c***@example.test');
  await expect(result.getByRole('link', { name: 'Back to Intake Forms' })).toHaveAttribute(
    'href',
    '/intake-forms',
  );
});

test('?formId= opens with that form chosen, and Preview Form shows its questions', async ({
  page,
}) => {
  await open(page, `/intake-forms/send?formId=${PERSONAL_TAX}`);
  await expect(page.getByRole('combobox', { name: /Form \/ Template/ })).toHaveValue(PERSONAL_TAX);
  await expect(page.getByTestId('send-form-card')).toContainText('Personal Tax Intake Form');
  await expect(page.getByTestId('send-form-card')).toContainText('42 questions');
  await expect(summaryRow(page, 'Form Name')).toContainText('Personal Tax Intake Form');
  await expect(page.getByRole('textbox', { name: /^Subject/ })).toHaveValue(
    'Your Personal Tax Intake Form',
  );

  await page.getByRole('button', { name: 'Preview Form' }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal Tax Intake Form' });
  await expect(dialog.getByTestId('send-form-preview')).toContainText('Personal Information');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('the summary follows every choice', async ({ page }) => {
  await open(page);
  const summary = page.getByTestId('send-summary');
  await expect(summary).toContainText('Not selected');

  await page.getByRole('radio', { name: 'Lead', exact: true }).click();
  await page.getByRole('button', { name: /^Lead/ }).click();
  await page.getByRole('option', { name: /Avery Sample/ }).click();
  await expect(summaryRow(page, 'Recipient')).toContainText('Avery Sample');
  await expect(summaryRow(page, 'Delivery Method')).toContainText('Email (avery@example.test)');
  // A lead has no portal access: that route stays visible but can't be chosen.
  await expect(page.getByRole('radio', { name: /^Client Portal/ })).toBeDisabled();
  await page.getByRole('radio', { name: /^SMS/ }).check();
  await expect(summaryRow(page, 'Delivery Method')).toContainText('SMS (');
  await expect(page.getByText('Send me a copy of the email')).toHaveCount(0);

  await page.getByLabel('Due Date (optional)', { exact: true }).fill('2030-12-01');
  await expect(summaryRow(page, 'Due Date')).toContainText('Dec 1, 2030');
  await page.getByRole('button', { name: 'Clear due date' }).click();
  await expect(summaryRow(page, 'Due Date')).toContainText('Not set');

  await page.getByRole('button', { name: /^Assign To/ }).click();
  await page.getByRole('option', { name: 'Adam Admin' }).click();
  await expect(summaryRow(page, 'Assigned To')).toContainText('Adam Admin');

  await page.getByRole('switch', { name: 'Send reminders' }).click();
  await expect(summaryRow(page, 'Reminders')).toContainText('Off');
  await page.getByRole('switch', { name: 'Allow client to save and continue' }).click();
  await expect(summaryRow(page, 'Client Can Save')).toContainText('No');
});

test('Send Form without a recipient or form marks the fields', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('combobox', { name: /Form \/ Template/ })).toBeVisible();
  await page.getByRole('button', { name: 'Send Form' }).click();
  await expect(page.getByText('Choose a client', { exact: true })).toBeVisible();
  await expect(page.getByText('Choose a form', { exact: true })).toBeVisible();
  await expect(page.getByTestId('send-result')).toHaveCount(0);
});

test('no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, `/intake-forms/send?formId=${PERSONAL_TAX}`);
  await page.getByRole('button', { name: /^Client/ }).click();
  await page.getByRole('option', { name: /Jamie Sample/ }).click();
  await expect(summaryRow(page, 'Recipient')).toContainText('Jamie Sample');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
