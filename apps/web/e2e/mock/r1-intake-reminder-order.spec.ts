import { expect, test, type Page } from '@playwright/test';

// R1, Intake Forms Review Two 10c: the send screen previews this form's two reminders in order.
// The mock firm's times are a first reminder 3 days after sending and a final one 7 days before the
// form expires, so a form expiring in 9 days would get its first after its final: that first is
// skipped, and the summary says so before sending. Mock mode as the Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const SKIPPED = 'First reminder skipped: it would come after the final reminder';

test.describe.configure({ timeout: 180_000 });

const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

async function expireOn(page: Page, day: string) {
  await page.getByLabel('Expiration', { exact: true }).selectOption('AT');
  await page.getByLabel('Expiration date').fill(day);
  await page.getByLabel('Expiration time').fill('23:59');
}

test('a first reminder that would come after the final is shown skipped before sending', async ({
  page,
}) => {
  await page.goto(app('/intake-forms/send'));
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible();
  const skips = page.getByTestId('reminder-skips');

  // 9 days: the final (7 days before) comes on day 2, the first (3 days after) on day 3.
  await expireOn(page, inDays(9));
  await expect(skips).toHaveText(SKIPPED);
  await page.getByRole('button', { name: 'View reminder schedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reminder Schedule' });
  await expect(dialog.getByTestId('send-schedule-form')).toContainText(SKIPPED);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

  // 30 days: both go, in order, at their own times.
  await expireOn(page, inDays(30));
  await expect(skips).toHaveCount(0);
  await page.getByRole('button', { name: 'View reminder schedule' }).click();
  const times = page
    .getByRole('dialog', { name: 'Reminder Schedule' })
    .getByTestId('send-schedule-form');
  await expect(times).not.toContainText('skipped');
  await expect(times.locator('dd')).toHaveCount(2);
  await expect(times.locator('dd').first()).toContainText(/\d{4}/);
  await expect(times.locator('dd').last()).toContainText(/\d{4}/);
});
