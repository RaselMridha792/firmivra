import { expect, test } from '@playwright/test';

// R60, the Client Portal module's Intake Forms (intake-form-client-portal.jpg; developer
// instructions 20 to 23), Communications, and Frame 1's Messages, Appointments, Tax Returns and
// Invoices & Payments tabs, all from the canonical modules. Request Form opens Send Intake Form
// with the client chosen. Mock mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("a client's intake forms: KPIs, side cards, and Request Form with the client chosen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/forms`));
  const forms = page.getByTestId('portal-forms');
  const kpis = forms.getByTestId('form-kpis');
  await expect(kpis).toContainText('Total Forms', { timeout: 60_000 });
  await expect(kpis).toContainText('Submitted Needs Review');
  await expect(kpis).toContainText('8');
  await expect(page.getByTestId('form-pending-actions')).toContainText('1 intake form submitted');
  await expect(forms).toContainText('Form Settings (Client Permissions)');

  await forms.getByRole('button', { name: 'Request Form' }).click();
  await expect(page).toHaveURL(app(`/intake-forms/send?clientId=${JAMIE}`));
  await expect(page.getByText('Jamie Sample').first()).toBeVisible({ timeout: 60_000 });
});

test("Frame 1's record tabs and Communications show the client's own records", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  for (const [tab, testId] of [
    ['messages', 'portal-messages'],
    ['appointments', 'portal-appointments'],
    ['tax-returns', 'portal-tax-returns'],
    ['invoices', 'portal-invoices'],
    ['intake-forms', 'portal-forms'],
  ] as const) {
    await page.goto(app(`/client-portal?client=${JAMIE}&tab=${tab}`));
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 60_000 });
  }
  await page.goto(app(`/client-portal/${JAMIE}/communications`));
  await expect(page.getByTestId('portal-messages')).toContainText('Communications', {
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: 'New Message' })).toBeVisible();
});
