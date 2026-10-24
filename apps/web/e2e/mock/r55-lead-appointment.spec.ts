import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L12: Schedule Appointment shows the lead's saved phone
// and email beside the name and the assigned staff member. In mock mode (playwright.mock.config.ts)
// as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

test('Schedule Appointment shows the lead’s phone and email', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const row = page
    .getByRole('table', { name: 'Leads' })
    .getByRole('row', { name: /Bruno Sandoval/ });
  const contact = await row.getByRole('cell').nth(2).innerText();
  const phone = contact.split('\n')[0]!.trim();
  await row.getByRole('button', { name: 'Schedule an appointment with Bruno Sandoval' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('For Bruno Sandoval');
  const details = dialog.getByRole('definition');
  await expect(details.first()).toHaveText(phone);
  await expect(details.nth(1)).toContainText('@');
  await expect(dialog.getByLabel('Lead contact')).toBeVisible();
});
