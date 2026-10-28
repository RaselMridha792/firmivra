import { expect, type Page, test } from '@playwright/test';

// Octavia's Dashboard review of Oct 24: Q1 to Q7 (the quick actions and + New go straight to each
// creation workflow) and Q10 (+ New closes on Escape, a click elsewhere, a choice and a route
// change, with keyboard navigation). Mock mode (playwright.mock.config.ts) as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openDashboard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await expect(page.getByTestId('quick-action')).toHaveCount(5, { timeout: 60_000 });
}

test('the five quick actions open each creation workflow', async ({ page }) => {
  await openDashboard(page);
  const actions = page.getByRole('region', { name: 'Quick actions' });
  for (const [name, href] of [
    ['Add Client', '/clients?new=1'],
    ['Send Message', '/messages?new=1'],
    ['Create Bulk Email', '/communications/new?channel=EMAIL'],
    ['Create Invoice', '/invoices/new'],
    ['Upload Now', '/documents/upload'],
  ] as const)
    await expect(actions.getByRole('link', { name })).toHaveAttribute('href', href);

  await actions.getByRole('link', { name: 'Add Client' }).click();
  await expect(page.getByRole('dialog', { name: 'Add New Client' })).toBeVisible({
    timeout: 60_000,
  });
});

test('Send a Message opens a new message, and Bulk Email creates nothing until Start', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/messages?new=1'));
  // New Message is its own page now (MSG-F09).
  await expect(page).toHaveURL(/\/messages\/new$/, { timeout: 60_000 });
  await expect(page.getByTestId('compose')).toBeVisible({ timeout: 60_000 });

  await page.goto(app('/communications/new?channel=EMAIL'));
  const start = page.getByTestId('new-communication');
  await expect(start).toContainText('New Bulk Email', { timeout: 60_000 });
  await expect(start).toContainText('Nothing is saved or sent until you start');
  await expect(page).toHaveURL(/\/communications\/new\?channel=EMAIL$/);
});

test('+ New offers each place something new starts, and closes as a menu should', async ({
  page,
}) => {
  await openDashboard(page);
  const button = page.getByRole('button', { name: 'New' });
  await button.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'New client',
    'New lead',
    'New appointment',
    'New task',
    'New invoice',
    'New message',
    'Bulk email',
    'Upload documents',
  ]);
  // The first item has focus; arrow keys move; Escape closes and gives focus back.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'New lead' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Upload documents' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // A click elsewhere closes it.
  await button.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(page.getByRole('menu')).toBeHidden();

  // A choice opens its form and closes the menu.
  await button.click();
  await page.getByRole('menuitem', { name: 'New client' }).click();
  await expect(page.getByRole('dialog', { name: 'Add New Client' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('menu')).toBeHidden();
});

test('?new=1 opens the form and keeps the drill-down: Back to Dashboard, stage and dates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/clients?new=1&back=dashboard'));
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('back-to-dashboard').click();
  await expect(page).toHaveURL(app('/'));

  // Leads takes both too: Add New Lead opens over the New Lead filter with Back to Dashboard.
  await page.goto(app('/leads?new=1&stage=SUBMITTED&back=dashboard'));
  await expect(page.getByRole('dialog', { name: /Add New Lead/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
});
