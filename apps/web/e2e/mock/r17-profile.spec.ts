import { expect, type Page, test } from '@playwright/test';

// N05 My Profile in mock mode. api.ts has no mock line for myProfile yet, so the profile routes
// are answered here with synthetic data (the preferences come from mocks/notifications.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

const profile = (portalRole: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED') => ({
  portalRole,
  fullName: 'Jamie Sample',
  dateOfBirth: portalRole === 'PRIMARY' ? '1985-04-12' : null,
  dateOfBirthUnavailable: false,
  email: 'jamie@example.test',
  phone: portalRole === 'AUTHORIZED' ? null : '+14045550100',
  address: {
    line1: portalRole === 'AUTHORIZED' ? null : '100 Sample Street',
    line2: null,
    city: portalRole === 'AUTHORIZED' ? null : 'Atlanta',
    state: portalRole === 'AUTHORIZED' ? null : 'GA',
    postalCode: portalRole === 'AUTHORIZED' ? null : '30301',
    country: 'US',
  },
  preferredContactMethod: null,
  referralSource: null,
  additionalInfo: null,
});

async function stub(page: Page, role: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED') {
  const sent: unknown[] = [];
  let me = profile(role);
  await page.route('**/api/v1/portal/lvp/me/profile**', async (route) => {
    const req = route.request();
    if (req.url().endsWith('/name-change')) {
      sent.push(req.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as { phone?: string };
      sent.push(body);
      me = { ...me, phone: body.phone ?? me.phone };
    }
    return route.fulfill({ json: me });
  });
  return sent;
}

test('the primary login edits contact details and asks for a name change', async ({
  page,
}, testInfo) => {
  const sent = await stub(page, 'PRIMARY');
  await page.goto(portal('/lvp/profile'));
  await expect(page).toHaveTitle('My Profile');
  await expect(page.getByText('Jamie Sample')).toBeVisible();
  await expect(page.getByText('04/12/1985')).toBeVisible();
  await expect(page.getByLabel('Email Address')).toBeDisabled();
  await page.getByLabel('Phone Number').fill('+14045550199');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your changes were saved.')).toBeVisible();
  expect(sent[0]).toMatchObject({ phone: '+14045550199' });
  expect(sent[0]).not.toHaveProperty('fullName');

  await page.getByRole('button', { name: 'Request Name Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request Name Change' });
  await dialog.getByLabel('New full name').fill('Jamie Sample-Doe');
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog.getByRole('status')).toContainText('Our team will review');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page.getByRole('link', { name: 'Change my password' })).toHaveAttribute(
    'href',
    '/lvp/forgot-password',
  );
  await expect(page.getByLabel('Account and security by email')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('profile-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('profile-375.png'), fullPage: true });
});

test('a spouse sees the record read-only; an authorized login sees the name only', async ({
  page,
}) => {
  await stub(page, 'SPOUSE');
  await page.goto(portal('/lvp/profile'));
  await expect(page.getByLabel('Phone Number')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
  await expect(page.getByText('Only the main account holder can change these.')).toBeVisible();

  await page.unrouteAll();
  await stub(page, 'AUTHORIZED');
  await page.reload();
  await expect(page.getByText('Jamie Sample')).toBeVisible();
  await expect(page.getByText('Date of Birth')).toHaveCount(0);
  await expect(page.getByLabel('Phone Number')).toHaveCount(0);
});
