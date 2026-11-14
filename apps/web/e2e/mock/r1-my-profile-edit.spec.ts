import { expect, test } from '@playwright/test';

// Dashboard Review 2 (R1), R2 NEW2: the firm's Owner edits their own name and job title on My
// Profile (Save or Cancel), and keeps changing their own number; the work email and role stay as
// they are. Mock mode as the Owner (the API refuses every other role, tested in staff-phone.e2e).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the Owner edits their profile; Cancel changes nothing and Save keeps it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/profile'));
  const details = page.getByTestId('my-profile');
  await expect(details).toContainText('Managing Partner (fake)', { timeout: 60_000 });

  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const form = page.getByRole('form', { name: 'Edit Profile' });
  await form.getByLabel('Last name *').fill('Changed');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(details).toContainText('Mock Owner');

  await page.getByRole('button', { name: 'Edit Profile' }).click();
  await form.getByLabel('First name *').fill('');
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await form.getByLabel('First name *').fill('Morgan');
  await form.getByLabel('Job title').fill('Founder (fake)');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(details).toContainText('Morgan Owner');
  await expect(details).toContainText('Founder (fake)');
  // No email or role field to edit; the Owner still changes their own number.
  await expect(page.getByLabel('Work email')).toHaveCount(0);
  await expect(
    page.getByTestId('my-phone').getByRole('button', { name: 'Change Number' }),
  ).toBeVisible();
  await expect(page.getByTestId('phone-owner-note')).toHaveCount(0);
});
