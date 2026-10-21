import { type Page, expect, test } from '@playwright/test';

// Settings > Workflow & Automations (/settings/workflow), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://app.localhost:${port}`;
const hub = `${origin}/settings/workflow`;
const BACK = 'Back to Workflow & Automations';

test('shows the return statuses and appointment types', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(hub);
  await expect(page).toHaveTitle('Workflow & automations');
  await expect(page.getByTestId('workflow-statuses').getByRole('listitem').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('workflow-types')).toContainText('minutes');
});

// Octavia, Oct 20: Open Automations and Open Tasks gave "Page not found" (they built
// /modules/<slug>, the page of modules that are not built yet). Every page the hub opens offers
// Back to Workflow & Automations, also after a refresh, beside its own back link.
const DESTINATIONS: { link: string; path: string; heading: string; ownBack?: string }[] = [
  { link: 'Edit Statuses', path: '/settings/tax-statuses', heading: 'Tax statuses' },
  {
    link: 'Manage Types',
    path: '/calendar/types',
    heading: 'Appointment Types',
    ownBack: 'Back to Appointments',
  },
  { link: 'Open Automations', path: '/automations', heading: 'Automation' },
  { link: 'Open Tasks', path: '/tasks', heading: 'Tasks' },
  {
    link: 'Teams & Departments',
    path: '/team/departments',
    heading: 'Teams & Departments',
    ownBack: 'Back to Staff Management',
  },
];

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

for (const d of DESTINATIONS) {
  test(`${d.link} opens ${d.path}, which leads back to the hub`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(hub);
    await page.getByRole('link', { name: d.link, exact: true }).click();
    await expect(page).toHaveURL(`${origin}${d.path}?from=workflow`);
    await expect(heading(page, d.heading)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Page not found')).toHaveCount(0);
    if (d.ownBack) await expect(page.getByRole('link', { name: d.ownBack })).toBeVisible();
    await page.reload();
    await expect(heading(page, d.heading)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: BACK }).click();
    await expect(page).toHaveURL(hub);
    await expect(heading(page, 'Workflow & Automations')).toBeVisible();
  });
}

test('a page opened another way has no Back to Workflow & Automations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ['/tasks', '/tasks?from=elsewhere', '/calendar/types']) {
    await page.goto(`${origin}${path}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: BACK })).toHaveCount(0);
  }
});
