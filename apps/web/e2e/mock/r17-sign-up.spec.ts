import { expect, test } from '@playwright/test';

// N02 step 1 in mock mode: portalAuth(slug) is the in-memory sign-up mock (mocks/client-auth.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the sign-up form checks its fields, shows the policies and starts a sign-up', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(portal('/lvp/sign-up'));
    await expect(page.getByRole('heading', { name: 'Create Your Account' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sign-up progress' })).toContainText(
      'Verify Phone',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`sign-up-${width}.png`), fullPage: true });
  }
  await expect(page).toHaveTitle('Sign up');

  const form = page.getByTestId('sign-up-form');
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(form.getByText('Agree to the Terms and Privacy Policy')).toBeVisible();

  await form.getByRole('button', { name: 'Terms of Service' }).click();
  await expect(page.getByRole('dialog')).toContainText('Version 2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await form.getByLabel('Full Name *').fill('Jamie Example');
  await form.getByLabel('Email Address *').fill('jamie@example.test');
  await form.getByLabel('Phone Number *').fill('(404) 555-0123');
  await form.getByLabel('Create a Password *').fill('Sample-pass-2026');
  await expect(form.getByRole('list', { name: 'Password rules' })).not.toContainText('not yet');
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2027');
  await form.getByRole('radio', { name: /Business/ }).check();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(form.getByText('The passwords do not match')).toBeVisible();

  // PRT-1: the firm has active locations, so the person picks theirs.
  await expect(form.getByText('Choose the office you will work with')).toBeVisible();
  await form.getByRole('radio', { name: /Lawrenceville Office/ }).check();
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2026');
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'));
});
