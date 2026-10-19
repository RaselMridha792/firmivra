import { expect, test } from '@playwright/test';

// The landing page and the signed-in shell against Octavia's mockups (Client portal landing
// page.png, My docs tab.png): the header buttons and the footer order. The sidebar shows the firm's
// motto (branding.sidebarMotto; the mock firm's is "PEOPLE | PLANS | PROSPERITY"), R61.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the landing page has the header buttons and the mockup copy', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp'));
  // LVP's header has the full navigation (Home, Services, Resources, Begin Online and the
  // appointment button); other firms get the two "Get started" buttons on the landing page only.
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(primary.getByRole('link', { name: 'Begin Online' })).toHaveAttribute(
    'href',
    '/lvp/begin',
  );
  await expect(primary.getByRole('link', { name: 'Schedule an Appointment' })).toHaveAttribute(
    'href',
    '/lvp/appointments',
  );
  // The hero's label (the footer has a "Client Portal" link too).
  await expect(
    page.getByTestId('portal-landing').getByText('Client Portal', { exact: true }),
  ).toBeVisible();
  // The firm's motto (branding.sidebarMotto) under the hero.
  await expect(page.getByTestId('landing-motto')).toContainText('PEOPLE');
  await expect(
    page.getByText(
      'Already have an account? Sign in to access your documents, messages, and more.',
    ),
  ).toBeVisible();
  // LVP's full footer (Client portal landing page.png): contact line and copyright, no "Powered by".
  await expect(page.locator('footer')).toContainText('All rights reserved.');
  await page.screenshot({ path: testInfo.outputPath('landing-1440.png'), fullPage: true });

  // Sign-in, sign-up, reset and Begin Online keep the visitor on their task: no "Get started" buttons.
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
  const motto = page.getByTestId('sidebar-motto').first();
  await expect(motto).toContainText('PEOPLE');
  await expect(motto).toContainText('PLANS');
  await expect(motto).toContainText('PROSPERITY');
  const footer = page.locator('footer');
  await expect(footer).toContainText(/Privacy Policy\s*\|\s*Terms of Service\s*\|\s*Contact Us/);
  await page.screenshot({ path: testInfo.outputPath('shell-1440.png'), fullPage: true });
});

test('portal pages open with the shared page header band', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/services'));
  // My Services draws its own heading (FIR-445, #461), not the shared band.
  await expect(page.getByRole('heading', { level: 1, name: 'My Services' })).toBeVisible();
  await expect(page.getByText("View and manage the services you've purchased with")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('services-1440.png') });
  await page.goto(portal('/lvp/profile'));
  await expect(page.getByTestId('portal-page-header')).toContainText('My Profile');
  await page.goto(portal('/lvp/taxes'));
  await expect(page.getByTestId('portal-page-header')).toContainText('My Client Portal');
  await page.screenshot({ path: testInfo.outputPath('taxes-1440.png') });
});
