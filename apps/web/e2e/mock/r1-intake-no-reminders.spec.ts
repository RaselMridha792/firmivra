import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two 22: the firm's No reminders (Intake Form Settings) holds on Send
// Intake Form: the switch is off and locked, and says why. Mock mode as the Owner; the mock keeps
// the setting for the session. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

test('with No reminders, a send cannot turn reminders on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/intake-forms/settings'));
  const first = page.getByRole('combobox', { name: 'First reminder' });
  await expect(first).toBeVisible({ timeout: 60_000 });
  await first.selectOption('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();

  // In the same session: Intake Forms, then Send Form to Client.
  await page
    .locator('nav')
    .getByRole('link', { name: 'Intake Forms', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Send Form to Client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible({
    timeout: 60_000,
  });
  const reminders = page.getByRole('switch', { name: 'Send reminders' });
  await expect(reminders).toBeDisabled();
  await expect(reminders).not.toBeChecked();
  await expect(page.getByText('Your firm sends no reminders (Intake Form Settings)')).toBeVisible();
  await expect(
    page.getByTestId('send-summary').locator('div').filter({ hasText: 'Reminders' }),
  ).toContainText('Off');
});
