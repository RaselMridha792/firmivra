import { expect, test } from '@playwright/test';

// The landing page and the signed-in shell against Octavia's mockups (Client portal landing
// page.png, My docs tab.png): the header buttons and the footer order. The firm's motto shows once
// PortalInfo serves branding.tagline (its own contract PR); until then the mock firm has none.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the landing page has the header buttons and the mockup copy', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp'));
  const start = page.getByRole('navigation', { name: 'Get started' });
  await expect(start.getByRole('link', { name: 'Begin Online' })).toHaveAttribute(
    'href',
    '/lvp/begin',
  );
  await expect(start.getByRole('link', { name: 'Clients: Book an Appointment' })).toHaveAttribute(
    'href',
    '/lvp/appointments',
  );
  await expect(page.getByText('Client Portal', { exact: true })).toBeVisible();
  await expect(page.getByTestId('landing-motto')).toHaveCount(0);
  await expect(
    page.getByText(
      'Already have an account? Sign in to access your documents, messages, and more.',
    ),
  ).toBeVisible();
  await expect(page.locator('footer')).toContainText('Powered by Firmivra');
  await page.screenshot({ path: testInfo.outputPath('landing-1440.png'), fullPage: true });

  // Sign-in, sign-up, reset and Begin Online keep the visitor on their task: no header buttons.
  for (const path of ['/lvp/sign-in', '/lvp/sign-up', '/lvp/forgot-password', '/lvp/begin']) {
    await page.goto(portal(path));
    await expect(page.getByRole('navigation', { name: 'Get started' })).toHaveCount(0);
  }
  await page.goto(portal('/lvp'));

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('landing-375.png'), fullPage: true });
});

test('the signed-in shell greets the client and shows the footer links', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/documents'));
  await expect(page.getByText('Welcome Back, John!')).toBeVisible();
  await expect(page.getByText('Your documents. Your services. All in one place.')).toBeVisible();
  await expect(page.getByTestId('sidebar-motto')).toHaveCount(0);
  const footer = page.locator('footer');
  await expect(footer).toContainText(/Privacy Policy\s*\|\s*Terms of Service\s*\|\s*Contact Us/);
  await page.screenshot({ path: testInfo.outputPath('shell-1440.png'), fullPage: true });
});

test('portal pages open with the shared page header band', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/services'));
  const band = page.getByTestId('portal-page-header');
  await expect(band.getByRole('heading', { level: 1, name: 'My Services' })).toBeVisible();
  await expect(band).toContainText("View and manage the services you've purchased with");
  await page.screenshot({ path: testInfo.outputPath('services-1440.png') });
  await page.goto(portal('/lvp/profile'));
  await expect(page.getByTestId('portal-page-header')).toContainText('My Profile');
  await page.goto(portal('/lvp/taxes'));
  await expect(page.getByTestId('portal-page-header')).toContainText('My Client Portal');
  await page.screenshot({ path: testInfo.outputPath('taxes-1440.png') });
});
