import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const port = process.env['WEB_PORT'] ?? '3000';
const site = (area: 'app' | 'admin', path = '/') => `http://${area}.localhost:${port}${path}`;
async function quick(page: Page, area: 'app' | 'admin', email: string) {
  await page.goto(site(area, '/sign-in?dev=1'));
  await page.getByRole('button', { name: new RegExp(email.replaceAll('.', '\\.')) }).click();
  await expect(page.getByTestId('me-email')).toHaveText(email);
}

test('real local password, setup QR, invalid MFA and correct MFA', async ({ page }) => {
  await page.goto(site('app', '/sign-in'));
  await expect(page).toHaveTitle(/Firmivra/);
  await page.getByLabel('Email Address', { exact: true }).fill('owner@lvp.test');
  await page.getByLabel('Password', { exact: true }).fill('Firmivra-local-1');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Set up your authenticator|Verify your identity/ }),
  ).toBeVisible();
  if (await page.getByRole('heading', { name: 'Set up your authenticator' }).isVisible())
    await expect(page.getByAltText('Authenticator setup QR code')).toBeVisible();
  await page.getByLabel('6-digit code', { exact: true }).fill('999999');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'code is incorrect' })).toContainText(
    'code is incorrect',
  );
  await page.getByLabel('6-digit code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByTestId('me-email')).toHaveText('owner@lvp.test');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
});
test('unknown credentials are generic; activation without an invite is blocked', async ({
  page,
}) => {
  await page.goto(site('app', '/sign-in'));
  await page.getByLabel('Email Address', { exact: true }).fill('unknown@example.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' }),
  ).toContainText('Email or password is incorrect');
  await page.goto(site('app', '/activate'));
  await expect(page.getByRole('alert').filter({ hasText: 'activation link' })).toContainText(
    'activation link',
  );
  await expect(page.getByRole('button', { name: 'Activate account', exact: true })).toBeDisabled();
});
test('staff routes and direct admin-only URLs respect the API role', async ({ page }) => {
  await quick(page, 'app', 'staff@lvp.test');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
  await page.goto(site('app', '/team'));
  await expect(page.getByRole('heading', { name: 'Permission required' })).toBeVisible();
  await page.goto(site('app', '/admin/dashboard'));
  await expect(page.getByRole('heading', { name: 'Permission required' })).toBeVisible();
});
test('preview client search, details and disabled mutations', async ({ page }) => {
  await quick(page, 'app', 'owner@lvp.test');
  await expect(page).toHaveTitle(/Firmivra/);
  await page.goto(site('app', '/clients?preview=1'));
  await expect(
    page.getByText('Preview only — synthetic examples. Changes are not saved.'),
  ).toBeVisible();
  await page.getByLabel('Search clients').fill('Alex');
  await expect(page.getByRole('table', { name: 'Clients' }).locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Alex Morgan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(page.getByText('***-**-0142', { exact: true })).toBeVisible();
  await page.goto(site('app', '/clients?preview=1'));
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Add client', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.goto(site('app', '/clients'));
  await expect(page.getByRole('heading', { name: 'No clients loaded' })).toBeVisible();
  await expect(page.getByText('Alex Morgan', { exact: true })).toHaveCount(0);
});
test('wizard keeps edits on Back and never claims persistence', async ({ page }) => {
  await quick(page, 'app', 'owner@lvp.test');
  await page.goto(site('app', '/setup?preview=1'));
  await page.getByLabel('Portal display name').fill('Example Firm');
  await page.getByRole('button', { name: 'Preview next step' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Portal display name')).toHaveValue('Example Firm');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});
test('invoice editor sums cents and multiple lines; send remains disabled', async ({ page }) => {
  await quick(page, 'app', 'owner@lvp.test');
  await page.goto(site('app', '/invoices?preview=1'));
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantity', { exact: true }).fill('3');
  await dialog.getByLabel('Unit price (USD)', { exact: true }).fill('19.99');
  await expect(dialog.getByText('Total: $59.97', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add line item' }).click();
  await dialog.getByLabel('Unit price (USD)', { exact: true }).nth(1).fill('10.00');
  await expect(dialog.getByText('Total: $69.97', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create invoice', exact: true })).toBeDisabled();
});
test('notifications update the shared bell count in preview', async ({ page }) => {
  await quick(page, 'app', 'owner@lvp.test');
  await page.goto(site('app', '/notifications?preview=1'));
  await expect(page.getByLabel('Notifications, 2 unread', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByLabel('Notifications', { exact: true })).toBeVisible();
});
test('all assigned screen routes load and mobile navigation works', async ({ page }) => {
  await quick(page, 'app', 'owner@lvp.test');
  for (const [route, heading] of [
    ['/team', 'Team'],
    ['/sign-ups', 'Pending sign-ups'],
    ['/documents', 'Documents'],
    ['/leads', 'Leads inbox'],
    ['/calendar', 'Calendar'],
    ['/availability', 'Availability'],
    ['/messages', 'Messages & notes'],
    ['/services', 'Service workspaces'],
    ['/workspaces/sample-bookkeeping', 'Bookkeeping workspace'],
  ]) {
    await page.goto(site('app', `${route}?preview=1`));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(site('app', '/dashboard?preview=1'));
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Clients', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('Super Admin applications and firms are platform-only previews', async ({ page }) => {
  await quick(page, 'admin', 'superadmin@firmivra.test');
  await page.goto(site('admin', '/applications?preview=1'));
  await page.getByRole('link', { name: 'Open Application' }).click();
  await expect(
    page.getByRole('heading', { name: 'LVP Accounting & Taxes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve Application', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Approve Application', exact: true }),
  ).toBeDisabled();
  await page.goto(site('admin', '/firms/sample-firm?preview=1'));
  await expect(page.getByRole('button', { name: 'Open Firm Workspace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Firm Workspace' })).toHaveCount(0);
});
test('sign-in and workspace pass automated accessibility checks', async ({ page }) => {
  await page.goto(site('app', '/sign-in'));
  await expect(page).toHaveTitle(/Firmivra/);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await quick(page, 'app', 'owner@lvp.test');
  await expect(page).toHaveTitle(/Firmivra/);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});
test('desktop and mobile review screenshots', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(site('admin', '/sign-in'));
    await page.screenshot({
      path: `../../docs/design/review/admin-sign-in-${width}.png`,
      fullPage: true,
    });
    await quick(page, 'admin', 'superadmin@firmivra.test');
    await page.goto(site('admin', '/applications?preview=1'));
    await expect(
      page.getByRole('heading', { name: 'Firm Applications', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../../docs/design/review/admin-applications-${width}.png`,
      fullPage: true,
    });
    await quick(page, 'app', 'owner@lvp.test');
    await page.goto(site('app', '/admin/dashboard?preview=1'));
    await expect(page.getByRole('heading', { name: /^Welcome back/ })).toBeVisible();
    await page.screenshot({
      path: `../../docs/design/review/firm-dashboard-${width}.png`,
      fullPage: true,
    });
    await page.goto(site('app', '/clients?preview=1'));
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    await page.screenshot({
      path: `../../docs/design/review/firm-clients-${width}.png`,
      fullPage: true,
    });
  }
});
