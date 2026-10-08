import { type APIRequestContext, expect, test } from '@playwright/test';

// Every LVP portal page from docs/junior/PAGE-MAP.md opens in its layout with its title.
// The title is the tab title from the page.tsx metadata (in the server HTML), not a heading.
// These tests open many pages; in `next dev` each compiles on its first visit.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const portal = (path: string) => `http://portal.localhost:${port}/lvp${path}`;

const publicPages: [path: string, title: string][] = [
  ['', 'Client portal'],
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Reset password'],
  ['/sign-up', 'Sign up'],
  ['/sign-up/verify-email', 'Verify your email'],
  ['/sign-up/verify-phone', 'Verify your phone'],
  ['/sign-up/done', 'Account created'],
  ['/begin', 'Begin online'],
  ['/begin/annual-tax', 'Annual tax preparation'],
  ['/begin/quarterly-tax', 'Quarterly tax'],
  ['/begin/bookkeeping', 'Bookkeeping'],
  ['/begin/payroll', 'Payroll'],
  ['/begin/tax-planning', 'Tax planning'],
  ['/begin/business-development', 'Business development'],
  ['/begin/resume', 'Resume your form'],
  ['/begin/done', 'Thank you'],
];

const clientPages: [path: string, title: string][] = [
  ['/intake', 'Intake Form'],
  ['/business', 'Business Documents & Resources'],
  ['/documents', 'My Uploaded Documents'],
  ['/taxes', 'Tax Returns'],
  ['/invoices', 'Receipts & Invoices'],
  ['/messages', 'Messages and Notes'],
  ['/appointments', 'Appointments'],
  ['/services', 'My Services'],
  ['/profile', 'My Profile'],
  ['/resources/startup-guide', 'Business Startup Guide'],
  ['/resources/record-keeping', 'Record Keeping Best Practices'],
  ['/resources/payroll', 'Payroll Resources'],
  ['/resources/tax-deductions', 'Tax Deductions for Small Businesses'],
  ['/resources/external-links', 'External Links'],
  ['/calculator', 'Calculator'],
  ['/notifications', 'Notifications'],
];

test('the public portal pages open without signing in', async ({ page }) => {
  for (const [path, title] of publicPages) {
    await page.goto(portal(path));
    await expect(page).toHaveURL(portal(path));
    await expect(page).toHaveTitle(title);
  }
});

test('every signed-in portal page opens in the client shell', async ({ page }) => {
  await page.goto(portal('/sign-in'));
  await page.getByRole('button', { name: /client@lvp\.test/ }).click();
  // Home opens the Intake Form tab.
  await expect(page).toHaveURL(portal('/intake'));
  await expect(page.getByRole('link', { name: 'Intake Form', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  for (const [path, title] of clientPages) {
    await page.goto(portal(path));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page).toHaveURL(portal(path));
    await expect(page).toHaveTitle(title);
  }
  // Home opens the Intake Form tab when opened from its URL too.
  await page.goto(portal('/home'));
  await expect(page).toHaveURL(portal('/intake'));
});

test('an encoded slash or backslash as the firm slug is a 404, never a redirect', async ({
  request,
}) => {
  for (const path of ['/%2Fevil.com/home', '/%5Cevil.com/home', '/%2F%2Fevil.com/sign-in']) {
    // Node can't resolve *.localhost (the browser can), so send the portal host as a header.
    const res = await request.get(`http://localhost:${port}${path}`, {
      headers: { host: `portal.localhost:${port}` },
      maxRedirects: 0,
    });
    expect(res.status(), path).toBe(404);
    expect(res.headers()['location'], path).toBeUndefined();
  }
});

/** GET on the portal host, without following redirects. */
const portalGet = (request: APIRequestContext, path: string) =>
  // Node can't resolve *.localhost (the browser can), so send the portal host as a header.
  request.get(`http://localhost:${port}${path}`, {
    headers: { host: `portal.localhost:${port}` },
    maxRedirects: 0,
  });

test('/{slug}/home opens the Intake Form tab: a relative 307 on this site, query dropped', async ({
  request,
}) => {
  const cases: [path: string, location: string][] = [
    ['/lvp/home', '/lvp/intake'],
    ['/lvp/home?next=//evil.example.test', '/lvp/intake'],
    // The redirect can't know which firms exist: an unknown slug stays on this site, and
    // /no-such-firm/intake then shows not-found (the portal layout).
    ['/no-such-firm/home', '/no-such-firm/intake'],
  ];
  for (const [path, location] of cases) {
    const res = await portalGet(request, path);
    expect(res.status(), path).toBe(307);
    expect(res.headers()['location'], path).toBe(location);
  }
});

test('a malformed slug before /home is a 404, never a redirect to another site', async ({
  request,
}) => {
  for (const path of ['/%2F%2Fevil.example.test/home', '/%2Fevil.example.test/home']) {
    const res = await portalGet(request, path);
    expect(res.status(), path).toBe(404);
    expect(res.headers()['location'], path).toBeUndefined();
  }
  // A raw "//" never reaches the app: Next.js first answers 308 to the same path with single
  // slashes, on this site, and that path is a 404 (a dot is not a slug).
  const doubled = await portalGet(request, '//evil.example.test/home');
  expect(doubled.status()).toBe(308);
  expect(doubled.headers()['location']).toBe('/evil.example.test/home');
  const res = await portalGet(request, '/evil.example.test/home');
  expect(res.status()).toBe(404);
  expect(res.headers()['location']).toBeUndefined();
});
