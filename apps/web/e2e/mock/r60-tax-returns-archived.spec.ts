import { expect, type Page, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F34 and TX-F35: archived returns are found under
// Show > Archived Returns (or Quick Actions), are read-only there, and are restored from the row
// menu, the bulk bar or the return's own page, with their status and history kept. In mock mode
// (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const menuOf = (page: Page, label: string) =>
  page.getByRole('table', { name: 'Tax returns' }).getByRole('button', { name: label });
const rowOf = (page: Page, label: string) =>
  page.getByRole('row').filter({ has: page.getByRole('button', { name: label }) });
const show = (page: Page) => page.getByTestId('tr-filters').getByLabel('Show');

/** Archives the first row from its menu and answers its menu label and status. */
async function archiveFirst(page: Page) {
  const first = page.getByRole('row').nth(1);
  const button = first.getByRole('button', { name: /^Actions for/ });
  const label = (await button.getAttribute('aria-label')) ?? '';
  const status = await first.getByRole('cell').nth(4).innerText();
  await button.click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Return archived.')).toBeVisible();
  await expect(menuOf(page, label)).toHaveCount(0);
  return { label, status };
}

test('an archived return is listed under Archived Returns, read-only, and restored as it was', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await expect(page.getByTestId('return-link').first()).toBeVisible();
  const { label, status } = await archiveFirst(page);

  await show(page).selectOption('archived');
  await expect(page.getByTestId('archived-view')).toContainText('not counted in the cards above');
  await expect(menuOf(page, label)).toHaveCount(1);
  await menuOf(page, label).click();
  const items = await page.getByRole('menuitem').allInnerTexts();
  expect(items.map((i) => i.trim())).toEqual(
    expect.arrayContaining([
      'Open / View Return',
      'View Client Profile',
      'Activity / Audit History',
      'Restore',
    ]),
  );
  for (const gone of ['Edit Return Details', 'Change Status', 'Assign / Reassign Staff']) {
    await expect(page.getByRole('menuitem', { name: gone })).toHaveCount(0);
  }
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Return restored.')).toBeVisible();
  await expect(menuOf(page, label)).toHaveCount(0);

  await show(page).selectOption('active');
  const row = rowOf(page, label);
  await expect(row.getByRole('cell').nth(4)).toHaveText(status);
  await row.getByRole('button', { name: label }).click();
  await page.getByRole('menuitem', { name: 'Activity / Audit History' }).click();
  await expect(page.getByTestId('activity-drawer')).toContainText('Return restored');
});

test('Quick Actions open the archived view, Clear keeps it, and the bulk bar restores', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await expect(page.getByTestId('return-link').first()).toBeVisible();
  const { label } = await archiveFirst(page);

  await page.getByTestId('quick-actions').getByRole('button', { name: 'Archived Returns' }).click();
  await expect(show(page)).toHaveValue('archived');
  await page.getByTestId('tr-filters').getByLabel('Return Type').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(show(page)).toHaveValue('archived');

  await rowOf(page, label).getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Assign Staff' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('1 return restored, with its history.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No archived returns' })).toBeVisible();
  await page.getByRole('button', { name: 'Show Active Returns' }).click();
  await expect(menuOf(page, label)).toHaveCount(1);
});

test('an archived return opened from the archived view says so and is restored there', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await expect(page.getByTestId('return-link').first()).toBeVisible();
  const { label } = await archiveFirst(page);
  await show(page).selectOption('archived');
  await menuOf(page, label).click();
  await page.getByRole('menuitem', { name: 'Open / View Return' }).click();

  const notice = page.getByTestId('archived-return');
  await expect(notice).toContainText('This return is archived');
  await notice.getByRole('button', { name: 'Restore Return' }).click();
  await expect(page.getByText('Return restored.')).toBeVisible();
  await expect(notice).toHaveCount(0);
});
