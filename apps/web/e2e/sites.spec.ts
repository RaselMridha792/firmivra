import { expect, type Page, test } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const site = (host: 'admin' | 'app' | 'portal', path = '/') =>
  `http://${host}.localhost:${port}${path}`;

async function signInAs(page: Page, url: string, email: string) {
  await page.goto(url + '?dev=1');
  await page.getByRole('button', { name: new RegExp(email.replace('.', '\\.')) }).click();
}

test.describe('each site loads on its own host', () => {
  test('Super Admin sign-in', async ({ page }) => {
    await page.goto(site('admin', '/sign-in'));
    await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
    await expect(page.getByText('SUPER ADMIN PORTAL', { exact: true }).first()).toBeVisible();
  });

  test('firm workspace sign-in', async ({ page }) => {
    await page.goto(site('app', '/sign-in'));
    await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
    await expect(page.getByText('FIRM WORKSPACE', { exact: true }).first()).toBeVisible();
  });

  test('client portal sign-in for LVP', async ({ page }) => {
    await page.goto(site('portal', '/lvp/sign-in'));
    await expect(page.getByRole('heading', { name: 'Client portal: lvp' })).toBeVisible();
  });

  test('internal folders are not reachable by path', async ({ request }) => {
    const res = await request.get(`http://localhost:${port}/admin`);
    expect(res.status()).toBe(404);
  });
});

test.describe('local sign-in works end to end (/api/v1/me)', () => {
  test('LVP owner in the firm workspace', async ({ page }) => {
    await signInAs(page, site('app', '/sign-in'), 'owner@lvp.test');
    // Firm workspace shell (skeleton): the header names the firm, the user menu the email.
    await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
    await page.getByRole('button', { name: /Owner/ }).click();
    await expect(page.getByTestId('me-email')).toHaveText('owner@lvp.test');
  });

  test('LVP client in the LVP portal, and no access to another firm', async ({ page }) => {
    await signInAs(page, site('portal', '/lvp/sign-in'), 'client@lvp.test');
    // Signed-in portal pages (skeleton): the footer names the firm, the user menu the email.
    await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
    await page.getByRole('button', { name: /Client/ }).click();
    await expect(page.getByTestId('me-email')).toHaveText('client@lvp.test');

    // Same browser, another firm's signed-in portal: the session is per host and the firm is not theirs.
    await page.goto(site('portal', '/test-firm-b/home'));
    await expect(page.getByTestId('firm-error')).toContainText('NOT_FOUND');
    await expect(page.getByTestId('page-title')).toHaveCount(0);
  });

  test('Super Admin in the admin console', async ({ page }) => {
    await signInAs(page, site('admin', '/sign-in'), 'superadmin@firmivra.test');
    // The console's user menu (app shell) shows the email once opened.
    await page.getByRole('button', { name: /Super Admin/ }).click();
    await expect(page.getByTestId('me-email')).toHaveText('superadmin@firmivra.test');
    await expect(page.getByText('Super Admin', { exact: false }).first()).toBeVisible();
  });

  test('signed-out visitors are sent to sign in', async ({ page }) => {
    await page.goto(site('app', '/'));
    await expect(page).toHaveURL(site('app', '/sign-in'));
  });
});
