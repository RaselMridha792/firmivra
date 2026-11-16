import { expect, type Page, test } from '@playwright/test';

// R55, Leads Review Two row 20a: only a Firm Admin (the Owner or the Admin) deletes leads (Delete
// is the archive, single or bulk) or restores them; the screen offers neither to Staff, and the
// API refuses them too (leads-pipeline e2e "Staff and a Manager get 403 on delete and restore").
// Mock mode; the Staff tab signs in through sessionStorage `fv-mock-role` (lib/mock.ts) on the
// same mock server. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

const ROW_MENU = ['View', 'Edit', 'Assign', 'Tags', 'Change Status', 'Convert to Client'];
const BULK = [
  'Send Email',
  'Send SMS',
  'Assign Staff',
  'Change Status',
  'Add to Campaign',
  'Add Tags',
  'Convert to Client',
];

/** The first row's menu, the bulk bar, and Archived Leads' bulk bar offer exactly these. */
async function expectOffered(
  page: Page,
  want: { menu: string[]; bulk: string[]; archived: string[] },
) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const row = page.getByRole('table', { name: 'Leads' }).locator('tbody tr').first();
  await row.getByRole('button', { name: /^More actions for / }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(want.menu);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await row.getByRole('checkbox').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' }).first();
  await expect(bar).toContainText('1 leads selected');
  await expect(bar.getByRole('button')).toHaveText(want.bulk);

  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByLabel('Archived leads').check();
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(page.getByLabel('Active filters')).toContainText('Archived Leads');
  // Nothing is archived in the mock: the empty list, with the bar its view offers.
  await expect(page.getByText('No leads match these filters')).toBeVisible();
  await expect(bar).toContainText('0 leads selected');
  await expect(bar.getByRole('button')).toHaveText(want.archived);
}

test('20a: the Owner is offered Archive, Delete and Restore', async ({ page }) => {
  await expectOffered(page, {
    menu: [...ROW_MENU, 'Archive'],
    bulk: [...BULK, 'Delete'],
    archived: ['Restore'],
  });
});

test('20a: Staff are offered no Archive, Delete or Restore', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-role', 'STAFF'));
  await expectOffered(page, { menu: ROW_MENU, bulk: BULK, archived: [] });
  // Signed in as Staff indeed: only the leads assigned to them (Daniel Okafor's three).
  await page.getByRole('button', { name: 'Remove Archived Leads' }).click();
  await expect(page.getByRole('table', { name: 'Leads' }).locator('tbody tr')).toHaveCount(3);
});
