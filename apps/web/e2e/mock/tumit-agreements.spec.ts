import { expect, test, type Page } from '@playwright/test';

// Settings > Terms & Privacy > Intake agreements in mock mode, as an owner. The mock has the
// firm-wide sample agreement (versions 1 and 2, three boxes in version 2) and one for the
// Bookkeeping service. Synthetic text only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openAgreements(page: Page) {
  await page.goto(app('/settings/legal'));
  await expect(page.getByTestId('page-title')).toHaveText('Terms & Privacy');
  await page.getByRole('tab', { name: 'Intake agreements' }).click();
}

test('an owner lists the agreements and reads the current and an older version', async ({
  page,
}) => {
  await openAgreements(page);
  const agreements = page.getByTestId('agreement');
  await expect(agreements).toHaveCount(2);
  await expect(agreements.first()).toContainText('Client Intake Agreement (sample)');
  await expect(agreements.first()).toContainText('Firm-wide');
  await expect(agreements.first()).toContainText('Version 2');
  await expect(agreements.nth(1)).toContainText('Service: Bookkeeping');

  await agreements.first().getByRole('button', { name: /^Open/ }).click();
  const boxes = page.getByRole('list', { name: 'Boxes the signer ticks' }).first();
  await expect(boxes.getByRole('listitem')).toHaveCount(3);
  await expect(boxes).toContainText('Optional');

  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('I have read the agreement');
  await expect(page.getByRole('dialog')).not.toContainText('My information is accurate');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '← All agreements' }).click();
  await expect(agreements).toHaveCount(2);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

test('an owner publishes the next firm-wide version', async ({ page }) => {
  await openAgreements(page);
  const agreements = page.getByTestId('agreement');
  await agreements.first().getByRole('button', { name: /^Open/ }).click();

  // The firm-wide agreement needs a required box: untick both, and the form says so.
  const boxes = page.getByTestId('agreement-box');
  await expect(boxes).toHaveCount(3);
  await boxes.nth(0).getByLabel('Required to submit').uncheck();
  await boxes.nth(1).getByLabel('Required to submit').uncheck();
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByText('The firm-wide agreement needs a required box.')).toBeVisible();

  await boxes.nth(0).getByLabel('Required to submit').check();
  await page.getByRole('button', { name: 'Add a box' }).click();
  await boxes.nth(3).getByLabel('Box label').fill('I agree to electronic delivery');
  await boxes.nth(3).getByLabel('Box text').fill('The firm may send my documents electronically.');
  await page.getByLabel('Title', { exact: true }).fill('Client Intake Agreement (sample, v3)');
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByRole('button', { name: 'Publish version 4' })).toBeVisible();
  await expect(page.getByText('I agree to electronic delivery').first()).toBeVisible();

  await page.getByRole('button', { name: '← All agreements' }).click();
  await expect(agreements.first()).toContainText('Client Intake Agreement (sample, v3)');
  await expect(agreements.first()).toContainText('Version 3');
});

test('a new service agreement gets its first version', async ({ page }) => {
  await openAgreements(page);
  await page.getByRole('combobox', { name: 'Service' }).selectOption({ label: 'Bookkeeping' });
  await page.getByRole('button', { name: 'Add agreement' }).click();
  await expect(page.getByRole('heading', { name: 'Write version 1' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Bookkeeping Add-on (sample)');
  await page.getByLabel('Agreement text').fill('Synthetic text: monthly statements by the 10th.');
  await page.getByRole('button', { name: 'Publish version 1' }).click();
  await expect(page.getByRole('button', { name: 'Publish version 2' })).toBeVisible();

  await page.getByRole('button', { name: '← All agreements' }).click();
  await expect(page.getByTestId('agreement')).toHaveCount(3);
});

test('a version keeps, replaces or refuses its PDF original', async ({ page }) => {
  await openAgreements(page);
  await page.getByTestId('agreement').first().getByRole('button', { name: /^Open/ }).click();
  await expect(page.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();

  const pdf = page.getByLabel('Replace the PDF original');
  await pdf.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByText('Upload a PDF file.')).toBeVisible();

  await pdf.setInputFiles({
    name: 'virus-sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(page.getByText('Blocked', { exact: true })).toBeVisible({ timeout: 15_000 });

  await pdf.setInputFiles({
    name: 'intake-terms-v3.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(page.getByText('Checking the PDF…')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByRole('button', { name: 'Publish version 4' })).toBeVisible();
  await expect(page.getByText(/intake-terms-v3\.pdf/).first()).toBeVisible();
});
