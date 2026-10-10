import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample, who has a W-2 PDF in Documents. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('an empty draft lists what is missing, each with where to fix it', async ({ page }) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Synthetic Review Empty');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('link', { name: 'Review and send' })
    .click();
  const problems = page.getByTestId('readiness');
  await expect(problems).toContainText('Add at least one file.');
  await expect(problems).toContainText('Choose the client.');
  await expect(problems).toContainText('Add at least one signer.');
  await expect(page.getByRole('button', { name: 'Send for signature' })).toHaveCount(0);
  await problems.getByText('Add at least one signer.').locator('..').getByRole('link').click();
  await expect(page).toHaveURL(/step=recipients$/);
});

test('a ready request is confirmed, then sent', async ({ page }) => {
  await page.goto(app(`/firm-sign/new?clientId=${JAMIE}`));
  await page.getByLabel('Document name').fill('Synthetic Review Ready');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  await page.getByLabel('File', { exact: true }).selectOption({ label: 'W-2_2025.pdf' });
  await page.getByRole('button', { name: 'Add file' }).click();
  await page.getByRole('link', { name: 'Next: Recipients' }).click();

  await page.getByRole('button', { name: 'Add a signer' }).click();
  const row = page.getByTestId('recipient-row').first();
  await row.getByLabel('Name').fill('Pat Example');
  await row.getByLabel('Email').fill('pat@example.com');
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('link', { name: 'Review and send' })
    .click();

  // No service yet: it is chosen here.
  await expect(page.getByTestId('readiness')).toContainText('Choose the service');
  await page.getByLabel('Service').selectOption({ label: '2025 Personal Tax' });
  await expect(page.getByTestId('readiness')).toHaveCount(0);
  const summary = page.getByTestId('review-summary');
  await expect(summary).toContainText('W-2_2025.pdf');
  await expect(summary).toContainText('1. Pat Example: Signs by email');
  await expect(summary).toContainText('a signature page is added');

  const send = page.getByRole('button', { name: 'Send for signature' });
  await expect(send).toBeDisabled();
  await page.getByLabel(/I checked the documents/).check();
  await send.click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+$/);
});
