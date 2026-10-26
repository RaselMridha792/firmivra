import { expect, test } from '@playwright/test';

// R29: the firm sidebar lists every item of the design; a module that is not built opens one
// shared page (src/lib/firm-modules.ts). Mock mode, as the Owner. Hiding the manager-only items
// from Staff is checked against the real API in e2e/skeleton-firm.spec.ts.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

// docs/mockups/firm-workspace/dashboard/firm-dashboard.webp, top to bottom, with Clients as the
// group of Overview, Sign-ups and Documents from Octavia's Client Sign-ups design (Oct 25).
const DESIGN_ITEMS = [
  'Dashboard',
  'Overview',
  'Documents',
  'Leads',
  'Appointments',
  'Intake Forms',
  'Client Portal',
  'Tax Returns',
  'Bookkeeping',
  'Payroll',
  'Tax Planning & Strategy',
  'Business Advisory & Development',
  'Invoices & Payments',
  'Messages',
  'Communications',
  'Tasks',
  'Automations',
  'Compliance & Deadlines',
  'Reports',
  'Templates',
  'Services & Pricing',
  'Staff Management',
  'Integrations',
  'Settings',
];

const nav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });

test('every item of the design is in the sidebar, in the design order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await expect(nav(page).getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  const labels = await nav(page).getByRole('link').allTextContents();
  const extras = new Set(['Sign-ups', 'Workspaces', 'Firm Sign', 'Audit log']);
  expect(labels.map((l) => l.replace(/\d+$/, '').trim()).filter((l) => !extras.has(l))).toEqual(
    DESIGN_ITEMS,
  );
  for (const extra of extras) {
    await expect(nav(page).getByRole('link', { name: extra, exact: true })).toHaveCount(1);
  }
});

test('Clients is an open group: Overview, Sign-ups and Documents, and it closes and opens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/sign-ups'));
  const group = nav(page).getByRole('button', { name: 'Clients' });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const items = nav(page).locator(`#${(await group.getAttribute('aria-controls')) ?? ''}`);
  await expect(items.getByRole('link')).toHaveText(['Overview', 'Sign-ups', 'Documents']);
  await expect(items.getByRole('link', { name: 'Sign-ups' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(nav(page).getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
  await group.click();
  await nav(page).getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL(app('/clients'));
});

test('an item without a page opens the module page and is marked in the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await nav(page).getByRole('link', { name: 'Client Portal', exact: true }).click();
  await expect(page).toHaveURL(app('/modules/client-portal'));
  await expect(page.getByTestId('page-title')).toHaveText('Client Portal');
  await expect(page.getByTestId('module-card')).toContainText('This module is on its way.');
  await expect(nav(page).getByRole('link', { name: 'Client Portal', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav(page).getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('an unknown module shows the not-found page', async ({ page }) => {
  await page.goto(app('/modules/no-such-module'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the module page has no horizontal scroll at 1440 and 390 px', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app('/modules/client-portal'));
    await expect(page.getByTestId('module-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
