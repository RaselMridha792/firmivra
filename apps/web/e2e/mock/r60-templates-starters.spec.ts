import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F18 (playwright.mock.config.ts, as an Owner): the mock
// installs the same 48 starters as the API (STARTER_TEMPLATES in packages/types), so the libraries
// show the guide's names, kinds and categories.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;

test('TP-F18: the Email library holds the guide’s client emails in their category', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  const side = page.getByTestId('category-sidebar');
  await side.getByRole('button', { name: /Email \/ Client Communication/ }).click();
  const table = page.getByTestId('library-table');
  for (const name of [
    'New Client Welcome Email',
    'Existing Client Welcome Back',
    'Missing Documents Follow-Up',
    'Document Received Confirmation',
    'General Client Follow-Up',
    'Client Portal Invitation',
  ]) {
    await expect(table).toContainText(name);
  }
  await expect(table.getByTestId('template-link')).toHaveCount(6);
});

test('TP-F18: appointments, payments and leads carry the guide’s names', async ({ page }) => {
  for (const [slug, name] of [
    ['appointment', 'Appointment Reminder — 24 Hours'],
    ['invoice-payment', 'Payment Overdue — Final Reminder'],
    ['lead-follow-up', 'Lead Follow-Up — No Response'],
  ]) {
    await page.goto(`${base}/library/${slug}`);
    await page.getByRole('searchbox', { name: 'Search templates' }).fill(name.split(' — ')[0]!);
    await expect(page.getByTestId('library-table')).toContainText(name);
  }
});
