import { expect, test } from '@playwright/test';

// R60, Octavia's Overview guide of Oct 18, item 18 (docs/specs/settings-review-2026-10-20/
// overview--*.md): the firm workspace's main menu collapses to icons, names each icon on hover
// and focus, remembers the choice in this browser, and stays the full slide-out on a phone.
// Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-sidebar-collapse';

test.describe.configure({ timeout: 180_000 });

test('the menu collapses to icons, names them, remembers it and expands again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/tasks'));
  const nav = page.getByRole('navigation', { name: 'Main' });
  const toggle = page.getByTestId('sidebar-toggle');
  // Expanded on the first visit.
  await expect(toggle).toHaveAccessibleName('Collapse menu', { timeout: 60_000 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect((await nav.boundingBox())?.width).toBe(246);

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Expand menu');
  await expect(nav).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await nav.boundingBox())?.width).toBe(72);
  // The page moves over with it.
  await expect.poll(async () => (await page.locator('main').boundingBox())?.x).toBeLessThan(100);

  // Every item keeps its name for screen readers, and shows it on hover.
  const tasks = nav.getByRole('link', { name: 'Tasks', exact: true });
  await expect(tasks).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Reports', exact: true }).hover();
  await expect(page.getByTestId('nav-tip')).toHaveText('Reports');
  await page.screenshot({ path: `${shots}/collapsed.png` });
  // The Clients group opens its first page.
  await expect(nav.getByRole('link', { name: 'Clients', exact: true })).toHaveAttribute(
    'href',
    /\/clients/,
  );

  // Remembered after a reload.
  await page.reload();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAccessibleName('Expand menu', {
    timeout: 60_000,
  });
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAccessibleName('Collapse menu');
  await expect.poll(async () => (await nav.boundingBox())?.width).toBe(246);
  await expect(nav.getByText('Tasks', { exact: true })).toBeVisible();

  // A phone keeps the full slide-out menu, even when collapsed on a wide screen.
  await page.getByTestId('sidebar-toggle').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /open menu/i }).click();
  const drawer = page.getByRole('navigation', { name: 'Main' }).last();
  await expect(drawer.getByText('Tasks', { exact: true })).toBeVisible();
  expect((await drawer.boundingBox())?.width).toBe(246);
  await page.screenshot({ path: `${shots}/phone.png` });
});
