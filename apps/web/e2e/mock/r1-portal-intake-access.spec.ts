import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two INTAKE-ACCESS-01: a form the client can no longer fill says why and
// what to do. The portal mock's fourth form (Payroll) has expired. Signing in from an intake
// email's link and landing back on the form is covered by lib/booking-intent.test.ts (mock mode
// is always signed in). Mock mode as the portal client; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const EXPIRED = '0199b6a8-0000-7000-8000-000000000004';

test('an expired form says it has expired and how to ask for it again', async ({ page }) => {
  await page.goto(portal(`/lvp/intake/${EXPIRED}`));
  const notice = page.getByTestId('intake-read-only');
  await expect(notice).toContainText('This form has expired, so it can no longer be filled in.');
  await expect(notice).not.toContainText('only the person it was sent to');
  await expect(notice.getByRole('link', { name: 'message your firm' })).toHaveAttribute(
    'href',
    '/lvp/messages',
  );
});
