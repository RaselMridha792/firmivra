import { expect, test } from '@playwright/test';

// R60, Octavia's Messages review of Oct 27 (MSG-F01, F03, F04, F05, F07, F08), mock mode as an
// Owner. Six active threads (Jamie Sample's five, Riley Example's one), one of them opened by an
// automation, and one archived thread of Riley's. Nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('MSG-F01: search finds the conversations by a full email and a phone in any format', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  const rows = page.getByTestId('thread-row');
  await expect(rows).toHaveCount(6);
  const search = page.getByLabel('Search messages');
  for (const typed of ['jamie.sample@example.test', '(404) 555-0123', '+1 404 555 0123']) {
    await search.fill(typed);
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) await expect(row).toContainText('Jamie Sample');
  }
  await search.fill('RILEY@example.test');
  await expect(rows).toHaveCount(1);
  await search.fill('(212) 555-0100');
  await expect(page.getByText('No conversations match.')).toBeVisible();
});

test('MSG-F03: Clients, Leads, Automations and Archived views over the same conversations', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  const rows = page.getByTestId('thread-row');
  await expect(rows).toHaveCount(6);
  await page.getByRole('tab', { name: /^Clients/ }).click();
  await expect(rows).toHaveCount(6);
  await page.getByRole('tab', { name: /^Leads/ }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('No conversations with leads yet.')).toBeVisible();
  await page.getByRole('tab', { name: /^Automations/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Automation');
  await expect(page.getByTestId('conversation')).toContainText('Welcome to the portal');
  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Archived');
  await expect(page.getByTestId('conversation')).toContainText('Thanks, all done.');
  // Documents stays as an extra view (D6).
  await page.getByRole('tab', { name: /^Documents/ }).click();
  await expect(rows).toHaveCount(1);
});

test('MSG-F05: Filter beside Search, with the filters shown and cleared', async ({ page }) => {
  await page.goto(app('/messages'));
  const rows = page.getByTestId('thread-row');
  await expect(rows).toHaveCount(6);
  const filterButton = page.getByRole('button', { name: /^Filter\s*\d*$/ });
  await filterButton.click();
  const panel = page.getByRole('region', { name: 'Filter conversations' });
  await panel.getByLabel('Replies').selectOption('closed');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Document request');
  await expect(page.getByTestId('messages-filters')).toContainText('Replies closed');
  await expect(filterButton).toContainText('1');
  await filterButton.click();
  await panel.getByLabel('Started by').selectOption('client');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('No conversations match.')).toBeVisible();
  await page.getByTestId('messages-filters').getByRole('button', { name: 'Clear Filters' }).click();
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId('messages-filters')).toHaveCount(0);
});

test('MSG-F04, F07: blue Bulk and Templates; Templates opens the message templates', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  const bulk = page.getByTestId('messages-bulk');
  const templates = page.getByTestId('messages-templates');
  // Blue text on a blue outline, not the white and grey of before.
  const isBlue = (el: Element) =>
    [getComputedStyle(el).color, getComputedStyle(el).borderTopColor].every((c) => {
      const [r = 0, g = 0, b = 0] = (c.match(/\d+/g) ?? []).map(Number);
      return b > 150 && b > r + 100 && b > g + 50;
    });
  expect(await bulk.evaluate(isBlue)).toBe(true);
  expect(await templates.evaluate(isBlue)).toBe(true);
  await templates.click();
  await expect(page).toHaveURL(/\/templates\/library\/portal-message\?from=%2Fmessages/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/messages'));
  await expect(page.getByTestId('page-title')).toHaveText('Messages');
});

test('MSG-F08: Open Client and Back return to the same thread, search and view', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByRole('tab', { name: /^Unread/ }).click();
  await page.getByLabel('Search messages').fill('riley');
  const rows = page.getByTestId('thread-row');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(page).toHaveURL(/\/messages\?tab=unread&q=riley&thread=/);
  const there = page.url();
  await page.getByTestId('contact-panel').getByRole('link', { name: 'Open Client' }).click();
  await expect(page).toHaveURL(/\/clients\/0199b6a1-0000-7000-8000-000000000003/);
  await expect(page.getByTestId('back-to-origin')).toHaveText(/Back to Messages/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(there);
  await expect(page.getByLabel('Search messages')).toHaveValue('riley');
  await expect(page.getByRole('tab', { name: /^Unread/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('conversation')).toContainText('I signed the letter');
});

test('A Payroll Send Message keeps its own Back while the view changes', async ({ page }) => {
  await page.goto(app('/payroll'));
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Send Message' }).click();
  await expect(page).toHaveURL(/\/messages\?clientId=.+&service=Payroll&from=/);
  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(page).toHaveURL(/tab=archived.*&from=%2Fpayroll/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/payroll'));
});
