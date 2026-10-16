import { expect, test } from '@playwright/test';

// One Begin Online lead in mock mode, as an owner. The mock has Avery Sample (new, Annual Tax),
// Blake Example (in review, Bookkeeping) and Casey Demo (declined). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const lead = (n: number) => app(`/leads/0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`);

test('a lead shows who sent it, the answers with the SSN masked, and the files', async ({
  page,
}) => {
  await page.goto(lead(1));
  await expect(page.getByTestId('page-title')).toHaveText('Avery Sample');
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByText('Annual Tax · 2025')).toBeVisible();
  await expect(page.getByText('•••-••-6789')).toBeVisible();
  await expect(page.getByText('123-45-6789')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Other files' })).toBeVisible();

  const files = page.getByTestId('lead-file');
  await expect(files).toHaveCount(1);
  await expect(files).toContainText('sample-w2.pdf');
  await expect(files.getByRole('button', { name: 'Download sample-w2.pdf' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

test('a declined lead shows the reason, and an unknown lead is not found', async ({ page }) => {
  await page.goto(lead(3));
  await expect(page.getByTestId('page-title')).toHaveText('Casey Demo');
  await expect(page.getByText('Declined', { exact: true })).toBeVisible();
  await expect(page.getByText('Outside the services we offer this season.')).toBeVisible();

  await page.goto(lead(99));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await page.getByRole('link', { name: '← All leads' }).click();
  await expect(page).toHaveURL(/\/leads$/);
});

test('an owner marks a lead in review, then converts it to a client', async ({ page }) => {
  await page.goto(lead(1));
  await page.getByRole('button', { name: 'Mark as in review' }).click();
  await expect(page.getByText('In review', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Convert to client' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('an engagement for Annual Tax');
  await expect(dialog.getByLabel(/an invitation to the client portal/)).toBeChecked();
  await dialog.getByRole('button', { name: 'Convert to client' }).click();
  await expect(
    page.getByText(/Converted to a client: .* The portal invitation was sent\./),
  ).toBeVisible();
  await expect(page.getByText('Converted', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0);
});

test('a duplicate email is explained, and a lead is declined with a reason', async ({ page }) => {
  await page.goto(lead(2));
  await page.getByRole('button', { name: 'Convert to client' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Convert to client' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Another client already has this email.');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Decline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Decline lead' }).click();
  await expect(page.getByText('Enter a reason')).toBeVisible();
  await page.getByLabel(/^Reason/).fill('We are not taking new bookkeeping clients this month.');
  await page.getByRole('dialog').getByRole('button', { name: 'Decline lead' }).click();
  await expect(page.getByText('Declined', { exact: true })).toBeVisible();
  await expect(
    page.getByText('We are not taking new bookkeeping clients this month.').first(),
  ).toBeVisible();
});
