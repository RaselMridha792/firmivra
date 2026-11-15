import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two 19b: Send Follow-Up (a reminder) says what really happened, and
// History keeps it. In the mock, Owen Hartley's form (the ninth) stands for a client with no
// portal sign-in; Selma Shields' (the fourth) reaches its client. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const form = (n: number, tab = '') =>
  `http://app.localhost:${port}/intake-forms/0199c0d0-0a00-7000-8000-${String(n).padStart(12, '0')}${tab}`;

test.describe.configure({ timeout: 180_000 });

test('a follow-up that reaches no one says why; one that does says sent', async ({ page }) => {
  await page.goto(form(9));
  await expect(page.getByTestId('client-card')).toContainText('Owen Hartley', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Send Follow-Up' }).click();
  await expect(
    page.getByText(/Nothing was sent: this client has no client portal login yet/),
  ).toBeVisible();
  await expect(page.getByText('Follow-up sent.')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Submission' })
    .getByRole('link', { name: 'History' })
    .click();
  await expect(page.getByTestId('history')).toContainText(
    'Reminder not delivered: the client has no portal sign-in',
  );

  await page.goto(form(4));
  await expect(page.getByTestId('client-card')).toContainText('Selma Shields', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Send Follow-Up' }).click();
  await expect(page.getByText('Follow-up sent.')).toBeVisible();
});
