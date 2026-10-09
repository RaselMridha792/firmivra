import { expect, test } from '@playwright/test';

const base = `http://app.localhost:${process.env['WEB_PORT'] ?? '3000'}`;
const queues = [
  'New clients',
  'Missing documents',
  'Preparation',
  'Review',
  'Signature',
  'Payment',
  'Filing',
  'Completed',
];
const menu = [
  'Dashboard',
  'Clients',
  'Sign-ups',
  'Leads',
  'Messages',
  'Calendar',
  'Invoices',
  'Workspaces',
  'Team',
  'Settings',
];

for (const width of [1536, 375]) {
  for (const role of ['owner', 'staff'] as const) {
    test(`${role} dashboard and menu at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1024 });
      await page.goto(`${base}/sign-in`);
      await page
        .getByRole('button', { name: `LVP ${role} (${role}@lvp.test)`, exact: true })
        .click();
      await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
      await expect(page.getByTestId('work-queue')).toHaveCount(8);
      for (const title of queues) {
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      }
      await expect(page.getByText('No items in this queue yet.', { exact: true })).toHaveCount(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 375) await page.getByRole('button', { name: 'Open menu' }).click();
      const nav = page.getByRole('navigation').filter({ visible: true });
      const expected =
        role === 'owner'
          ? menu
          : menu.filter((name) => !['Sign-ups', 'Team', 'Settings'].includes(name));
      await expect(nav.getByRole('link')).toHaveText(expected);
      for (const name of ['Sign-ups', 'Team', 'Settings']) {
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
