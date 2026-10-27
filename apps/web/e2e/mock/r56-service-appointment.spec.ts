import { expect, test } from '@playwright/test';

// SH6 (Octavia's Oct 25 review: PY-F11; TX-F06 for R60): Schedule Appointment from a service
// workspace opens the shared appointment form on that client and service, with Back to the
// workspace; Cancel returns there without creating anything. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

for (const [module, path] of [
  ['Payroll', '/payroll'],
  ['Bookkeeping', '/bookkeeping'],
] as const) {
  test(`${module}: Schedule Appointment is prefilled with the client, and Cancel creates nothing`, async ({
    page,
  }) => {
    await page.goto(`${app}${path}`);
    await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
    await page.getByRole('menuitem', { name: 'Schedule Appointment' }).click();
    await expect(page).toHaveURL(/\/calendar\/new\?clientId=.+&engagementId=.+&from=/);
    await expect(page.getByTestId('page-title')).toHaveText('Schedule Appointment');
    await expect(page.getByText('Green Leaf Café LLC').first()).toBeVisible();
    await expect(page.getByTestId('back-to-origin')).toHaveText(`Back to ${module}`);
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(`${app}${path}`);
  });
}
