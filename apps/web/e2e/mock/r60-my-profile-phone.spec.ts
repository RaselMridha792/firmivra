import { expect, test } from '@playwright/test';

// R60, Octavia's Overview guide of Oct 18, item 20 (docs/specs/settings-review-2026-10-20/
// overview--*.md): every member changes their own mobile phone on My Profile and proves it with
// a code by text; name, work email and role stay with the administrators. Mock mode as the Owner
// (the mock's number is fake; every code is 000000). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-my-profile-phone';

test.describe.configure({ timeout: 180_000 });

test('a member changes, verifies and removes their own mobile phone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/profile'));
  const phone = page.getByTestId('my-phone');
  await expect(phone).toContainText('(770) 555-0123', { timeout: 60_000 });
  await expect(phone).toContainText('Not verified');
  // The rest stays read-only.
  await expect(page.getByTestId('my-profile')).toContainText('Work email');
  await expect(page.getByLabel('Work email')).toHaveCount(0);

  await phone.getByRole('button', { name: 'Change Number' }).click();
  const field = phone.getByLabel('Mobile phone *');
  await expect(field).toHaveValue('(770) 555-0123');
  await field.fill('12345');
  await phone.getByRole('button', { name: 'Save Number' }).click();
  await expect(phone.getByRole('alert')).toContainText('country code');
  await field.fill('(404) 555-0177');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/edit.png` });
  await phone.getByRole('button', { name: 'Save Number' }).click();
  await expect(phone).toContainText('(404) 555-0177');
  await expect(phone).toContainText('Not verified');

  // Verified with a code by text, as in My Settings.
  await phone.getByRole('button', { name: 'Send Code' }).click();
  await phone.getByLabel('Code from the text *').fill('000000');
  await phone.getByRole('button', { name: 'Verify' }).click();
  await expect(phone.getByTestId('mobile-verified')).toContainText('Verified');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/verified.png` });

  // Removed: My Settings then points back here.
  await phone.getByRole('button', { name: 'Remove Number' }).click();
  await expect(phone).toContainText('No mobile number yet');
  await page.getByRole('link', { name: 'My Settings' }).first().click();
  const card = page.getByTestId('mobile-number');
  await expect(card).toContainText('You have no mobile number yet', { timeout: 60_000 });
  await card.getByRole('link', { name: 'My Profile' }).click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 60_000 });
  await page.getByTestId('my-phone').getByRole('button', { name: 'Add Number' }).click();
  await page.getByLabel('Mobile phone *').fill('+14045550178');
  await page.getByRole('button', { name: 'Save Number' }).click();
  await expect(page.getByTestId('my-phone')).toContainText('(404) 555-0178');
});
