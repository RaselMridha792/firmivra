import { expect, test } from '@playwright/test';

// N06 Intake tab: the forms the firm published to the portal (Intake Review 2 ACCESS-02e), and a
// form's frame for an unknown path.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the intake tab lists only the forms the firm published to the portal', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/intake'));
  await expect(page).toHaveTitle('Intake Form');
  // Intake Review 2 ACCESS-02e (R1, the lead's decision of Nov 17): no fixed cards and no dead
  // Other Tax Services button; the mock firm has published one form to the portal.
  const forms = page.getByRole('list', { name: 'Intake forms' });
  await expect(forms.getByTestId('portal-form')).toHaveCount(1, { timeout: 60_000 });
  await expect(forms).toContainText('Quarterly Check-In');
  await expect(page.getByRole('link', { name: /^Go to / })).toHaveCount(0);
  await expect(page.getByText('Other Tax Services Intake Form')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('intake-1440.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('intake-375.png'), fullPage: true });
});

test('an unknown form is not found', async ({ page }) => {
  const res = await page.goto(portal('/lvp/intake/not-a-form'));
  await expect(page.getByRole('list', { name: 'Form steps' })).toHaveCount(0);
  expect(res?.status()).toBeLessThan(500);
});
