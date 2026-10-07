import { expect, type Page, test } from '@playwright/test';

// The kit's data cache belongs to one person (lib/session.ts: claimCache, releaseCache): after
// sign-out, the next person on the same tab never sees the previous person's rows, not even while
// their own are loading. Every step navigates inside the app (no page load, which would empty
// the cache anyway). The tax statuses API is the lead's T04, so the test answers for it.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
const at = '2026-10-07T09:00:00.000Z';
const statuses = (name: string) => ({
  items: [
    {
      id: '0199b6a0-0000-7000-8000-000000000901',
      name,
      sortOrder: 0,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
    },
  ],
});

async function openTaxStatuses(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.getByRole('link', { name: 'Tax statuses', exact: true }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Tax statuses');
}

test("the next person on the tab never sees the previous person's data", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let signedIn = 'lvp';
  await page.route('**/api/v1/business/tax-statuses**', async (route) => {
    const firm = signedIn;
    if (firm === 'firm-b') await held;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(statuses(firm === 'lvp' ? 'LVP only status' : 'Firm B status')),
    });
  });

  await page.goto(app('/sign-in'));
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('firm-name')).toBeVisible();
  await openTaxStatuses(page);
  await expect(page.getByText('LVP only status')).toBeVisible();

  await page.getByRole('button', { name: /Owner/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(app('/sign-in'));

  signedIn = 'firm-b';
  await page.getByRole('button', { name: /owner@firm-b\.test/ }).click();
  await expect(page.getByTestId('firm-name')).not.toHaveText(/LVP/);
  await openTaxStatuses(page);
  // Firm B's list is still on its way: the page shows loading, never LVP's rows.
  await expect(page.getByTestId('page-loading')).toBeVisible();
  await expect(page.getByText('LVP only status')).toHaveCount(0);

  release();
  await expect(page.getByText('Firm B status')).toBeVisible();
  await expect(page.getByText('LVP only status')).toHaveCount(0);
});
