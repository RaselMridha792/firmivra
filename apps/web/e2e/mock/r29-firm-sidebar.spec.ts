import { expect, test } from '@playwright/test';

// R29: the firm sidebar lists every item of the design; a module that is not built opens one
// shared page (src/lib/firm-modules.ts). Mock mode, as the Owner. Hiding the manager-only items
// from Staff is checked against the real API in e2e/skeleton-firm.spec.ts.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

// docs/mockups/firm-workspace/dashboard/firm-dashboard.webp, top to bottom.
const DESIGN_ITEMS = [
  'Dashboard',
  'Clients',
  'Leads',
  'Appointments',
  'Intake Forms',
  'Documents',
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

test('an item without a page opens the module page and is marked in the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await nav(page).getByRole('link', { name: 'Tax Returns', exact: true }).click();
  await expect(page).toHaveURL(app('/modules/tax-returns'));
  await expect(page.getByTestId('page-title')).toHaveText('Tax Returns');
  await expect(page.getByTestId('module-card')).toContainText('This module is on its way.');
  await expect(nav(page).getByRole('link', { name: 'Tax Returns', exact: true })).toHaveAttribute(
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
    await page.goto(app('/modules/business-advisory'));
    await expect(page.getByTestId('module-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
