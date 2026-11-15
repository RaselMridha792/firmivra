import { expect, type Page, test } from '@playwright/test';

// R55, Clients Review 2 (C2-034): after a bulk staff change, a client profile seen before the
// change shows the new assignee straight away, with no reload. Every step moves inside the app
// (links, not page.goto), so the profile seen first is still in the page's data cache.
// Mock mode as the Owner (src/mocks/clients.ts: Riley Example has nobody assigned; Jamie Sample
// is Sam Staff's). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** The client's entry in the list: a card at her 1165 px width, a table row on wider screens. */
const row = (page: Page, name: string) =>
  page
    .locator('[data-testid="client-card"], [data-testid="clients-table"] tbody tr')
    .filter({ visible: true })
    .filter({ hasText: name });
/** The "Assigned to" line of the profile's Firm details. */
const assignedOnProfile = (page: Page) =>
  page
    .getByTestId('client-overview')
    .locator('dt', { hasText: /^Assigned to$/ })
    .locator('xpath=following-sibling::dd[1]');

async function openProfileFromList(page: Page, name: string) {
  await row(page, name).getByTestId('client-link').click();
  await expect(page.getByTestId('page-title')).toHaveText(name, { timeout: 60_000 });
}

async function backToClients(page: Page) {
  await page.getByRole('main').getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });
}

/**
 * Records every text the profile's "Assigned to" line shows from now on (the page is never
 * reloaded, so this keeps watching across in-app navigation). A stale value painted first and
 * replaced a moment later still lands here.
 */
async function watchAssigned(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { assignedSeen: string[] }).assignedSeen = seen;
    const read = () => {
      const dt = [...document.querySelectorAll('[data-testid="client-overview"] dt')].find(
        (node) => node.textContent?.trim() === 'Assigned to',
      );
      const text = dt?.nextElementSibling?.textContent?.trim();
      if (text && seen.at(-1) !== text) seen.push(text);
    };
    new MutationObserver(read).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
const assignedSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { assignedSeen: string[] }).assignedSeen);

async function bulkAssign(page: Page, name: string, choice: string) {
  await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: 'Assign Staff Member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Staff Member' });
  await dialog.getByLabel('Assign to').selectOption({ label: choice });
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText('1 client updated.')).toBeVisible();
}

// Clients Review 2 (C2-034, §2 Staff assignment): she opened a profile, assigned that client from
// the directory, and reopening the profile still said Unassigned until a reload.
test('a profile seen before a bulk assign shows the new staff member when opened again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });

  await openProfileFromList(page, 'Riley Example');
  await expect(assignedOnProfile(page)).toHaveText('Unassigned');
  await backToClients(page);

  await bulkAssign(page, 'Riley Example', 'Adam Admin');
  await expect(row(page, 'Riley Example')).toContainText('A. Admin');

  await watchAssigned(page);
  await openProfileFromList(page, 'Riley Example');
  await expect(assignedOnProfile(page)).toHaveText('Adam Admin');
  // Never the old value first, even for a moment.
  expect(await assignedSeen(page)).toEqual(['Adam Admin']);
});
