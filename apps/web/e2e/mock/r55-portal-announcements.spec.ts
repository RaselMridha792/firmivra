import { expect, test } from '@playwright/test';

// R55, Client Portal guide 3 (Rasel, Oct 24: the parts without schema): announcements published
// in Communications show in the portal, as the design's preview draws them
// (client-portal-announcements-dashboard.jpg): an Announcement card with a dismiss button and
// View All Announcements. In mock mode (playwright.mock.config.ts), with two synthetic ones.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const shots = 'e2e/mock/r55-screenshots/portal';

test('the tabs show the newest announcement for their page, dismissable, with View All', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/intake'));
  const card = page.getByTestId('announcement-card');
  await expect(card).toContainText('Announcement');
  await expect(card.getByRole('heading', { name: 'Extended Office Hours' })).toBeVisible();
  await expect(card).toContainText('to better serve you');
  await page.getByRole('complementary', { name: 'Help and shortcuts' }).screenshot({
    path: `${shots}/announcement-card.png`,
  });

  // The billing one shows on Receipts & Invoices only.
  await page
    .getByRole('navigation', { name: 'Portal folders' })
    .getByRole('link', { name: 'Receipts & Invoices' })
    .click();
  await expect(card.getByRole('heading', { name: 'Pay invoices online' })).toBeVisible();

  await card.getByRole('link', { name: 'View All Announcements' }).click();
  await expect(page).toHaveURL(/\/lvp\/announcements$/);
  await expect(page.getByRole('heading', { name: 'Announcements', level: 1 })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.screenshot({ path: `${shots}/announcements-page.png` });
});

test('a dismissed announcement leaves the card but stays in View All', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/intake'));
  const card = page.getByTestId('announcement-card');
  await card.getByRole('button', { name: 'Dismiss announcement' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Quick Links' })).toBeVisible();
  await expect(page.getByTestId('announcement-card')).toHaveCount(0);
  await page.goto(portal('/lvp/announcements'));
  await expect(page.getByRole('heading', { name: 'Extended Office Hours' })).toBeVisible();
});
