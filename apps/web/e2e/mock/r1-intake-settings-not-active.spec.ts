import { expect, test, type Page } from '@playwright/test';

// R1, Intake Forms Review Two row 23: every Intake setting now works (23-c to 23-f, the automation
// rules, run at submit), so none says "Not active yet". Mock mode as the Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const row = (page: Page, label: string) =>
  page.locator('span, label').filter({ hasText: label }).first();

test('Intake Review 2 23-c to 23-f: the automation rules work, so nothing in Intake says Not active yet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/intake-forms/settings'));
  await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeVisible({
    timeout: 60_000,
  });
  for (const label of [
    'Auto-create client record',
    'Auto-create follow-up task',
    'Route by service type',
    'Default follow-up owner',
    'Send confirmation email to client',
    'Notify assigned staff member',
  ]) {
    await expect(row(page, label), label).not.toContainText('Not active yet');
  }
  await expect(page.getByText('Not active yet')).toHaveCount(0);
});
