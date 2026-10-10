import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Use template: the client role needs a client or someone named', async ({ page }) => {
  await page.goto(app('/firm-sign/templates'));
  await page.getByRole('link', { name: 'Section 7216 Consent' }).click();
  await page.getByRole('link', { name: 'Use template' }).click();

  await expect(page.getByTestId('page-title')).toHaveText('New signature request');
  await expect(page.getByLabel('Start from')).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByText('Preparer: you')).toBeVisible();
  // No client chosen: the Client role has to be filled by hand.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Client: who')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Client: who').selectOption('external');
  await page.getByLabel('Client: name').fill('Sam Sample');
  await page.getByLabel('Client: email').fill('not-an-email');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Client: email')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Client: email').fill('sam.sample@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare/);
  await expect(page.getByText('Section 7216 Consent').first()).toBeVisible();
});

test('Use template for a client fills the client role from the portal login', async ({ page }) => {
  await page.goto(app(`/firm-sign/new?clientId=${JAMIE}`));
  const start = page.getByLabel('Start from');
  await start.selectOption({ label: 'Template: Tax Engagement Letter' });
  await expect(page.getByLabel('Client: who')).toHaveValue('auto');
  await page.getByLabel('Document name (optional)').fill('2025 Engagement Letter');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare/);
  await expect(page.getByText('2025 Engagement Letter').first()).toBeVisible();
});
