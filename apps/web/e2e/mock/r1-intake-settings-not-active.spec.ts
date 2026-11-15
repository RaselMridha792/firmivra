import { expect, test, type Page } from '@playwright/test';

// R1, Intake Forms Review Two row 23: a setting that saves but that Firmivra does not act on yet
// says "Not active yet" (client confirmation email, the three automations, the follow-up owner);
// the ones that work (Notify assigned staff member, accepted file types) do not. Mock mode as the
// Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const row = (page: Page, label: string) =>
  page.locator('span, label').filter({ hasText: label }).first();

test('the settings Firmivra does not act on yet say so', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/intake-forms/settings'));
  await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeVisible({
    timeout: 60_000,
  });
  for (const label of [
    'Send confirmation email to client',
    'Auto-create client record',
    'Auto-create follow-up task',
    'Route by service type',
    'Default follow-up owner',
  ]) {
    await expect(row(page, label), label).toContainText('Not active yet');
  }
  await expect(row(page, 'Notify assigned staff member')).not.toContainText('Not active yet');
});
