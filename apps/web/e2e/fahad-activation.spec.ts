import { expect, test } from '@playwright/test';
const origin = `http://app.localhost:${process.env['WEB_PORT'] ?? '3000'}`;
const token = 'synthetic-invitation-for-F02-browser-contract';
test('activation consumes fragment, validates password and starts MFA through the contract', async ({
  page,
}) => {
  let checked = false;
  await page.route('**/api/v1/auth/activation/check', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    expect(route.request().url()).not.toContain(token);
    checked = true;
    await route.fulfill({
      json: {
        email: 'invite@firmivra.test',
        name: 'Synthetic invite',
        role: 'STAFF',
        business: {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Test firm',
          slug: 'test-firm',
          status: 'ACTIVE',
        },
        expiresAt: '2026-10-14T00:00:00Z',
      },
    });
  });
  await page.route('**/api/v1/auth/activate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token,
      name: 'Synthetic invite',
      password: 'Firmivra-local-1',
    });
    await route.fulfill({
      json: { status: 'MFA_SETUP_REQUIRED', session: 'synthetic-setup-session' },
    });
  });
  await page.route('**/api/v1/auth/mfa/setup', (route) =>
    route.fulfill({
      json: {
        session: 'synthetic-code-session',
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/Firmivra:test?secret=JBSWY3DPEHPK3PXP&issuer=Firmivra',
      },
    }),
  );
  await page.goto(`${origin}/activate#token=${token}`);
  await expect(page.getByTestId('activate-form')).toBeVisible();
  expect(checked).toBe(true);
  await expect(page).toHaveURL(`${origin}/activate`);
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Confirm new password').fill('short');
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByText('At least 12 characters', { exact: true }).first()).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('Firmivra-local-1');
  await page.getByLabel('Confirm new password').fill('Firmivra-local-1');
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByRole('img', { name: 'Authenticator setup QR code' })).toBeVisible();
  await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(token);
});
test('expired invitation and query-token links are handled safely', async ({ page }) => {
  await page.route('**/api/v1/auth/activation/check', (route) =>
    route.fulfill({ status: 410, json: { error: { code: 'INVITE_EXPIRED', message: 'Expired' } } }),
  );
  await page.goto(`${origin}/activate#token=${token}`);
  await expect(page.getByTestId('page-error')).toContainText('invitation has expired');
  await expect(page).toHaveURL(`${origin}/activate`);
  await page.goto(`${origin}/activate?token=${token}`);
  await expect(page.getByRole('status')).toContainText('Open the activation link');
  await expect(page).toHaveURL(`${origin}/activate`);
});
