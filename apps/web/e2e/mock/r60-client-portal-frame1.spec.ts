// R60, the Client Portal module's Frame 1 (client-portal.jpg; instructions 1 to 10): Switch
// Client's search, the Clients list's search, status filter and pages, the header's actions, the
// More menu, View All Activity, and the last client reopened. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Frame 1: Switch Client finds a client by name, and the list searches, filters by status and pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/client-portal'));
  const list = page.getByTestId('portal-client-list');
  const rows = list.getByTestId('portal-client-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });

  // Switch Client: search, then pick.
  const switcher = page.getByTestId('client-switcher');
  await switcher.locator('button[aria-haspopup="listbox"]').click();
  await switcher.getByLabel('Search clients').fill('Jamie');
  const option = switcher
    .getByRole('listbox', { name: 'Clients' })
    .getByRole('option')
    .filter({ hasText: 'Jamie Sample' });
  await option.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`client=${JAMIE}`));
  await expect(page.getByTestId('client-portal-header')).toContainText('Jamie Sample');

  // The list's search: only matching clients, and a no-match message.
  const search = list.getByLabel('Search clients');
  await search.fill('Jamie');
  await expect
    .poll(async () => (await rows.allInnerTexts()).every((t) => t.includes('Jamie')))
    .toBe(true);
  await search.fill('zz-no-such-client');
  await expect(list).toContainText('No clients match these filters.');
  await search.fill('');
  await expect(rows.first()).toBeVisible();

  // The status filter: every row shows the status chosen.
  const status = list.getByLabel('Status', { exact: true });
  const chosen = (await status.locator('option').nth(1).innerText()).trim();
  await status.selectOption({ index: 1 });
  await expect
    .poll(async () => {
      const texts = await rows.allInnerTexts();
      const empty = (await list.innerText()).includes('No clients match these filters.');
      return empty || (texts.length > 0 && texts.every((t) => t.includes(chosen)));
    })
    .toBe(true);
  await status.selectOption({ index: 0 });

  // Pages: the summary names the rows shown out of the whole list.
  await expect(list).toContainText(/Showing 1 – \d+ of \d+ clients/);
});

test('Frame 1: Send Message, View Profile, the More menu and View All Activity open their pages; the last client reopens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/client-portal?client=${JAMIE}`));
  const actions = page.getByTestId('client-portal-actions');
  await expect(page.getByTestId('client-portal-header')).toContainText('Jamie Sample', {
    timeout: 60_000,
  });

  await actions.getByRole('button', { name: 'Send Message' }).click();
  await expect(page).toHaveURL(app(`/messages/new?clientId=${JAMIE}`));
  await page.goBack();
  await actions.getByRole('button', { name: 'View Profile' }).click();
  await expect(page).toHaveURL(app(`/clients/${JAMIE}`));
  await page.goBack();

  await actions.getByRole('button', { name: 'More portal actions' }).click();
  for (const item of ['Portal Management', 'Access & Security', 'View Activity History']) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Access & Security' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/access`));
  await page.goBack();

  await page.getByTestId('recent-activity').getByText('View All Activity').click();
  await expect(page).toHaveURL(new RegExp(`/client-portal/${JAMIE}/activity`));

  // The module opened again from the menu, with no client in the address: the last client is
  // reopened (the mock keeps Recent Clients in the page, so this moves in-app).
  await page.getByTestId('sidebar-menu').getByRole('link', { name: 'Client Portal' }).click();
  await expect(page).toHaveURL(app('/client-portal'));
  await expect(page.getByTestId('client-portal-header')).toContainText('Jamie Sample', {
    timeout: 60_000,
  });
});
