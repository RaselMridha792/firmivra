import { expect, test } from '@playwright/test';

// Every LVP portal page from docs/junior/PAGE-MAP.md opens in its layout with its title.
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
    await expect(page.getByTestId('page-title')).toHaveText(title);
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
    await expect(page.getByTestId('page-title')).toHaveText(title);
  }
});
