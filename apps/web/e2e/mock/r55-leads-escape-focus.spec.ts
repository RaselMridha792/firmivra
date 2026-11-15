import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 14: Escape closes Add New Lead and puts the focus back on the Add New
// Lead button, so a keyboard user carries on from where they were. Mock mode as the Owner.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 14: after Escape, the focus is back on Add New Lead', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const add = page.getByRole('button', { name: 'Add New Lead' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill('Esc');
  await expect(add).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
});
