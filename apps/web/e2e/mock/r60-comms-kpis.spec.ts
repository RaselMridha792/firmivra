import { expect, type Page, test } from '@playwright/test';

// R60, C23 and C32 (Communications Review 2): every KPI card counts what it opens (Sent History's
// sent ones of the last 30 days, by the day sent) and its number matches that list; Total
// Recipients opens it with the most recipients first and the total. The list filters by status
// and dates and sorts. Mock mode as the Owner; nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

test.describe.configure({ timeout: 180_000 });

const card = (page: Page, label: string) =>
  page.getByTestId('comm-kpis').getByRole('button').filter({ hasText: label });
const valueOf = async (page: Page, label: string) =>
  (await card(page, label).locator('span.text-2xl').textContent())?.trim() ?? '';

test('C23: each card opens Sent History with its filter, and the numbers match', async ({
  page,
}) => {
  await page.goto(base);
  await expect(card(page, 'Total Sent')).toContainText('Last 30 days', { timeout: 60_000 });
  const sent = await valueOf(page, 'Total Sent');
  const recipients = await valueOf(page, 'Total Recipients');

  await card(page, 'Total Sent').click();
  const totals = page.getByTestId('comm-list').getByTestId('list-totals');
  await expect(totals).toContainText(new RegExp(`^${sent} communications?`));
  await expect(page.getByTestId('comm-list').getByLabel('Status')).toHaveValue('SENT');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await card(page, 'Total Recipients').click();
  await expect(totals).toContainText(`${recipients} recipients`);
  await expect(page.getByTestId('comm-list').getByLabel('Sort by')).toHaveValue('performance');
});

test('C32: the list filters by status and dates and sorts', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Sent History' }).click({ timeout: 60_000 });
  const list = page.getByTestId('comm-list');
  const totals = list.getByTestId('list-totals');
  await expect(totals).toBeVisible();
  await list.getByLabel('Status').selectOption('SENT');
  await list.getByLabel('Sent from').fill('2099-01-01');
  await expect(totals).toContainText(/^0 communications · 0 recipients/);
  await list.getByLabel('Sent from').fill('');
  await list.getByLabel('Sort by').selectOption('name');
  const names = await list.getByTestId('comm-link').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test('C28: search looks in the message; a whole row opens; menus open and close with no draft', async ({
  page,
}) => {
  await page.goto(base);
  const drafts = async () => {
    await page.getByRole('button', { name: 'New Communication' }).click();
    await page.getByRole('menuitem', { name: 'Resume Draft' }).click();
    const picker = page.getByTestId('draft-picker');
    // Counted once the list has loaded.
    await expect(
      picker.getByRole('link').first().or(picker.getByText('You have no drafts.')),
    ).toBeVisible({ timeout: 30_000 });
    const n = await picker.getByRole('link').count();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    return n;
  };
  await expect(page.getByRole('button', { name: 'New Communication' })).toBeVisible({
    timeout: 60_000,
  });
  const before = await drafts();
  // Opening and closing a menu (by keys too) makes nothing.
  const menu = page.getByRole('button', { name: 'New Communication' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Resume Draft' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press(' ');
  await page.keyboard.press('Escape');
  expect(await drafts()).toBe(before);

  // A word only in a message's text finds it.
  await page.getByRole('tab', { name: 'Sent History' }).click();
  const list = page.getByTestId('comm-list');
  await list.getByLabel('Search communications').fill('approaching');
  await expect(list.getByTestId('comm-link').first()).toBeVisible();
  // A click on the row, away from its name, opens it.
  const row = list.getByRole('row').nth(1);
  await row
    .getByRole('cell')
    .last()
    .click({ position: { x: 2, y: 2 } })
    .catch(() => undefined);
  await row.getByRole('cell').nth(2).click();
  await expect(page).toHaveURL(/\/communications\/[0-9a-f-]+/);
});
