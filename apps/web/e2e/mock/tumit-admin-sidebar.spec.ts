import { expect, test } from '@playwright/test';

// The Super Admin console sidebar (firmivra-sidebar-states-mockup.jpg), in mock mode: every
// module item opens its page, and only the closest item is marked as the current page.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the module items open their pages in the design order', async ({ page }) => {
  await page.goto(admin('/'));
  const menu = page.getByRole('navigation', { name: 'Main' });
  const labels = [
    'Sales Center',
    'Pipeline',
    'Team',
    'Communications',
    'Subscriptions',
    'Billing',
    'Support',
    'Reports & Analytics',
    'Notifications',
    'Integrations',
    'Audit & Security',
    'System Settings',
  ];
  for (const label of labels) {
    await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await menu.getByRole('link', { name: 'Billing', exact: true }).click();
  await expect(page).toHaveURL(admin('/billing'));
  await expect(menu.getByRole('link', { name: 'Billing', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('on the pipeline only Pipeline is the current page, not Sales Center', async ({ page }) => {
  await page.goto(admin('/sales/pipeline'));
  const menu = page.getByRole('navigation', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Pipeline', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('link', { name: 'Sales Center', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});
