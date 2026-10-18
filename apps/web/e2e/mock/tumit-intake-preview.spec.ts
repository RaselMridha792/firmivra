import { expect, test } from '@playwright/test';

// Intake Forms > Create New Intake Form, the Preview tab, in mock mode (the intake forms mock, as
// an owner). The form is the mock's Personal Tax Intake Form: five sections, 21 questions.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const url = app('/intake-forms/builder/0199c0d0-0f00-7000-8000-000000000001/preview');
const NOTE = 'Check the prior-year carryover before filing.';

test('the Preview tab shows the unsaved draft as the client sees it', async ({ page }) => {
  await page.goto(url);
  await expect(page).toHaveTitle(/^Create intake form: Preview/);
  const tabs = page.getByRole('navigation', { name: 'Build Your Form' });
  await expect(tabs.getByRole('link', { name: 'Preview' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Form Builder' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );

  const preview = page.getByTestId('form-preview');
  await expect(
    preview.getByText('This is how your client sees the form. Nothing is sent from the preview.'),
  ).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Personal Tax Intake Form' })).toBeVisible();
  await expect(preview.getByText('Intake for personal tax intake clients.')).toBeVisible();
  await expect(preview.getByRole('progressbar', { name: 'Form progress' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );

  // The sections in order, each question as the client answers it, required ones marked *.
  await expect(
    preview.getByTestId('preview-section').getByRole('heading', { level: 4 }),
  ).toHaveText([
    'Personal Information',
    'Address Information',
    'Income Information',
    'Deductions & Credits',
    'Document Uploads',
  ]);
  await expect(preview.getByTestId('preview-question')).toHaveCount(21);
  await expect(preview.getByRole('textbox', { name: 'Full name *' })).toBeDisabled();
  await expect(preview.getByText('Drag & drop files here or click to upload')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Submit' })).toBeDisabled();
  await expect(
    preview.getByText("Thank you! We've received your information and will be in touch soon."),
  ).toBeVisible();

  // The preview follows the unsaved draft and never shows the internal notes.
  const details = page.getByTestId('form-details');
  await details
    .getByRole('textbox', { name: /Description/ })
    .fill("Have last year's return ready.");
  await details.getByRole('textbox', { name: /Internal Notes/ }).fill(NOTE);
  await expect(preview.getByText("Have last year's return ready.")).toBeVisible();
  await expect(preview.getByText(NOTE)).toHaveCount(0);

  // With file uploads off, the client gets no drop area.
  await page.getByRole('switch', { name: 'Allow file uploads' }).click();
  await expect(preview.getByText('Drag & drop files here or click to upload')).toHaveCount(0);
  await expect(preview.getByTestId('upload-off')).toBeVisible();
});

test('the preview fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await expect(page.getByTestId('preview-section')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: test.info().outputPath('intake-preview-mobile.png'),
    fullPage: true,
  });
});
