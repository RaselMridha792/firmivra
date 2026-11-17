// Octavia's Payroll Review 2, F02: the portal shows a request's due date, and the staff
// file names the request it answered. Mock mode: Green Leaf Café's payroll, and the portal.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const portal = `http://portal.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';
/** The documents mock's Green Leaf payroll request, answered from the portal. */
const GREEN_REQUEST = '0199b6a6-0000-7000-8000-000000000090';

test('F02: a file the client sent for a request names that request, with a link to it', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=documents`);
  const doc = page
    .getByTestId('payroll-document')
    .filter({ hasText: 'Fake_Q4_Payroll_Register.pdf' });
  await expect(doc).toContainText('For request: Fake Q4 payroll register');
  await expect(doc.getByRole('link', { name: 'Fake Q4 payroll register' })).toHaveAttribute(
    'href',
    new RegExp(`/documents/requests/${GREEN_REQUEST}`),
  );
});

test('F02: the portal shows a request’s due date on a line of its own', async ({ page }) => {
  await page.goto(`${portal}/lvp/documents`);
  const due = page.getByTestId('request-due');
  await expect(due.first()).toBeVisible();
  for (const line of await due.all()) {
    await expect(line).toHaveText(/^Due [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  }
  // The mock's requests are due Oct 31, 2026.
  await expect(due.filter({ hasText: 'Due Oct 31, 2026' }).first()).toBeVisible();
});
