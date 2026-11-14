import { expect, test } from '@playwright/test';

// R60, Tax Returns Review 2 (TX-F06): Schedule Appointment from a tax return opens the shared
// form on its client with Link to Tax Return set to that return (kept as the return's engagement
// by the API); another client's returns are never offered. Mock mode as the Owner; client 1 is
// Jamie Sample, whose 2025 Form 1040 is in its service. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const ret = '0199b6a3-0000-7000-8000-000000000001';

test('a return opens Schedule Appointment linked to it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/calendar/new?clientId=${jamie}&taxReturnId=${ret}`));
  const link = page.getByLabel('Link to Tax Return');
  await expect(link).toBeEnabled({ timeout: 90_000 });
  await expect(link).toHaveValue(ret);
  await expect(link.locator('option', { hasText: '2025 1040 Return' })).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'e2e/screenshots/r60-tax-returns-appointment/linked.png' });
});
