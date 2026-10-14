import { expect, test } from '@playwright/test';

const base = `http://app.localhost:${process.env['WEB_PORT'] ?? '3000'}`;
// Octavia's order (docs/mockups/firm-workspace/dashboard), then the four extras.
const menu = [
  'Dashboard',
  'Clients',
  'Sign-ups',
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
  'Workspaces',
  'Firm Sign',
  'Audit log',
  'Staff Management',
  'Integrations',
  'Settings',
];

for (const width of [1536, 375]) {
  for (const role of ['owner', 'staff'] as const) {
    test(`${role} dashboard and menu at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1024 });
      await page.goto(`${base}/sign-in`);
      await page.getByRole('button', { name: `Quick sign-in: ${role}@lvp.test` }).click();
      await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
      await expect(page.getByTestId('page-title')).toContainText('Welcome back');
      await expect(page.getByTestId('kpi-card')).toHaveCount(6);
      await expect(page.getByTestId('pipeline-stage')).toHaveCount(5);
      for (const name of [
        'Revenue Overview',
        'Service Breakdown',
        'Tasks Due',
        'Recent Messages',
      ]) {
        await expect(page.getByRole('region', { name })).toBeVisible();
      }
      // Create Invoice is the Owner's and Admin's.
      await expect(page.getByTestId('quick-action')).toHaveCount(role === 'owner' ? 5 : 4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 375) await page.getByRole('button', { name: 'Open menu' }).click();
      const nav = page.getByRole('navigation').filter({ visible: true });
      const expected =
        role === 'owner'
          ? menu
          : menu.filter(
              (name) => !['Sign-ups', 'Audit log', 'Staff Management', 'Settings'].includes(name),
            );
      // A menu item may end with its unread count (Messages).
      await expect(nav.getByRole('link')).toHaveText(
        expected.map((name) => new RegExp(`^${name.replace(/[&()]/g, '\\$&')}\\d*$`)),
      );
      for (const name of ['Sign-ups', 'Audit log', 'Staff Management', 'Settings']) {
        await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(
          role === 'owner' ? 1 : 0,
        );
      }
      if (width === 375) {
        await page.getByRole('button', { name: 'Close menu' }).click();
        await expect(page.getByTestId('firm-dashboard')).toBeVisible();
      }
      await page.screenshot({ path: `../../tmp/f03-${role}-${width}.png`, fullPage: true });
    });
  }
}
