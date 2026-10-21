import { expect, test } from '@playwright/test';

// R56: the Settings review's Overview items that need no Locations data (Oct 20 change list):
// Company Profile (item 2), the header search (7), the Help & Support slide-out (8) and the account
// menu (9), with My Profile. Mock mode signs in as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const firm = (path: string) => `http://app.localhost:${port}${path}`;
const SEARCH = 'Search clients, locations, or team members';

test('the Settings menu names Company Profile', async ({ page }) => {
  await page.goto(firm('/settings/overview'));
  const menu = page.getByRole('navigation', { name: 'Settings' });
  await expect(menu.getByRole('link', { name: 'Company Profile', exact: true })).toHaveAttribute(
    'href',
    '/settings/profile',
  );
  await expect(menu.getByRole('link', { name: 'Profile', exact: true })).toHaveCount(0);
});

test('the header search finds clients and team members and opens them', async ({ page }) => {
  await page.goto(firm('/'));
  const box = page.getByRole('searchbox', { name: SEARCH, exact: true });
  await expect(box).toHaveAttribute('placeholder', `${SEARCH}…`);

  await box.fill('jamie');
  const results = page.getByRole('region', { name: 'Search results' });
  const clients = results.getByRole('region', { name: 'Clients' });
  await expect(clients.getByRole('link', { name: /Jamie Sample/ })).toBeVisible();

  await box.fill('priya');
  const team = results.getByRole('region', { name: 'Team members' });
  await expect(team.getByRole('link', { name: /Priya Ramos/ })).toHaveAttribute(
    'href',
    /^\/team\//,
  );

  // Each result opens its record (the link, not a navigation: a cold dev compile is slow).
  await box.fill('jamie');
  await expect(clients.getByRole('link', { name: /Jamie Sample/ })).toHaveAttribute(
    'href',
    /^\/clients\/[0-9a-f-]+$/,
  );

  // Enter still opens the clients list with the text.
  await box.press('Enter');
  await expect(page).toHaveURL(firm('/clients?search=jamie'), { timeout: 60_000 });
});

test('Help & Support opens the shared slide-out, from the "?" and the account menu', async ({
  page,
}) => {
  await page.goto(firm('/'));
  await page.getByRole('button', { name: 'Help & Support' }).click();
  const panel = page.getByRole('dialog', { name: 'Help & Support' });
  await expect(panel.getByRole('link', { name: /Contact Support/ })).toHaveAttribute(
    'href',
    'mailto:admin@firmivra.com',
  );
  const report = panel.getByRole('link', { name: /Report a Problem/ });
  const href = (await report.getAttribute('href')) ?? '';
  expect(href).toMatch(/^mailto:admin@firmivra\.com\?subject=Report%20a%20Problem&body=/);
  // The page's path, never its query.
  expect(decodeURIComponent(href)).toContain('Page: /\n');
  // No help site yet, so no Help Center entry (Rasel, Oct 21).
  await expect(panel.getByText('Help Center')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.locator('header').getByRole('button', { name: /Owner/ }).click();
  await page.getByRole('menuitem', { name: 'Help & Support' }).click();
  await expect(panel).toBeVisible();
});

test('the account menu offers My Profile, My Settings, Help, Admin Panel and Sign out', async ({
  page,
}) => {
  await page.goto(firm('/'));
  await page.locator('header').getByRole('button', { name: /Owner/ }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText([
    'My Profile',
    'My Settings',
    'Help & Support',
    'Admin Panel',
    'Sign out',
  ]);
  await expect(page.getByRole('menuitem', { name: 'My Settings' })).toHaveAttribute(
    'href',
    '/settings/notifications',
  );
  await expect(page.getByRole('menuitem', { name: 'Admin Panel' })).toHaveAttribute(
    'href',
    '/settings/overview',
  );

  await page.getByRole('menuitem', { name: 'My Profile' }).click();
  await expect(page).toHaveURL(firm('/profile'));
  await expect(page).toHaveTitle(/My Profile/);
  const email = await page.getByTestId('me-email').count();
  expect(email).toBe(0);
  const profile = page.getByTestId('my-profile');
  await expect(profile).toContainText('Work email');
  await expect(profile).toContainText('Owner');
});

test('My Profile fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(firm('/profile'));
  await expect(page.getByTestId('my-profile')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
