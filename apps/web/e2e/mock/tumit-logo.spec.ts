import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = `http://admin.localhost:${port}`;
const app = `http://app.localhost:${port}`;

test.describe('in a 1903 × 959 window', () => {
  test.use({ viewport: { width: 1903, height: 959 } });

  test('the sidebar shows the official logo in white, and its menu fits with no scroll bar', async ({
    page,
  }) => {
    await page.goto(`${admin}/`);
    await expect(page.getByRole('heading', { name: 'Welcome back, Morgan!' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Main' });
    const logo = nav.getByRole('img', { name: 'Firmivra' });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /firmivra-logo-white/);
    await expect(nav.getByText('Super Admin Portal')).toBeVisible();

    const menu = nav.getByTestId('sidebar-menu');
    await expect(menu.getByText('System Settings')).toBeVisible();
    expect(await menu.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
  });
});

test('a page on a light background shows the logo with its navy wordmark', async ({ page }) => {
  await page.goto(`${app}/welcome`);

  const logo = page.getByRole('img', { name: 'Firmivra' });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /firmivra-logo\./);
  await expect(page.getByText('Firm workspace', { exact: true }).first()).toBeVisible();
});
