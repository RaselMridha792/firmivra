import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item 4 (CHANGE-LIST L1): the lead's name, More > View and
// the Overview tab all open the Lead Workspace's Overview for that lead, whatever its status, in
// mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;
const lead = (n: number) => `${url}/0199c0c0-0a00-7000-8000-${String(n).padStart(12, '0')}`;
const CARDS = [
  'card-contact',
  'card-lead-details',
  'figure-next-follow-up',
  'figure-lead-score',
  'figure-interested-in',
  'card-recent-activity',
  'card-upcoming-appointments',
  'card-follow-up',
  'card-open-tasks',
  'card-quick-actions',
];

test('the name and More > View open that lead’s Overview, in any status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const table = page.getByRole('table', { name: 'Leads' });
  // In Follow-Up: a status the old page could not open ("couldn't find").
  await table.getByRole('link', { name: /Bruno Sandoval/ }).click();
  await expect(page).toHaveURL(lead(3));
  await expect(page.getByTestId('lead-name')).toHaveText('Bruno Sandoval');
  for (const card of CARDS) await expect(page.getByTestId(card)).toBeVisible();
  await expect(page.getByTestId('lead-state')).toHaveCount(0);
  await expect(page.getByTestId('card-lead-details')).toContainText('In Follow-Up');
  await expect(page.getByTestId('card-recent-activity')).toContainText('Lead created');

  await page.goto(url);
  await table.getByRole('button', { name: 'More actions for Selma Shields' }).click();
  await page.getByRole('menuitem', { name: 'View' }).click();
  await expect(page).toHaveURL(lead(4));
  await expect(page.getByTestId('lead-name')).toHaveText('Selma Shields');
  await expect(page.getByTestId('card-contact')).toContainText('Selma Shields');

  // Overview from another tab comes back to the same lead.
  await page
    .getByRole('navigation', { name: 'Lead profile' })
    .getByRole('link', { name: 'Notes' })
    .click();
  await page
    .getByRole('navigation', { name: 'Lead profile' })
    .getByRole('link', { name: 'Overview' })
    .click();
  await expect(page).toHaveURL(lead(4));
  await expect(page.getByTestId('lead-overview')).toBeVisible();
});

test('an overdue follow-up is red, and Mark Not Qualified keeps the lead', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Grace Pruitt: a new lead whose email follow-up is a day past due.
  await page.goto(lead(12));
  await expect(page.getByTestId('lead-name')).toHaveText('Grace Pruitt');
  const next = page.getByTestId('card-lead-details').getByText(/^Overdue: Email/);
  await expect(next).toHaveClass(/text-danger/);
  await expect(page.getByTestId('figure-next-follow-up')).toContainText('Overdue');

  await page.goto(lead(2));
  await page
    .getByTestId('card-quick-actions')
    .getByRole('button', { name: 'Mark Not Qualified' })
    .click();
  await page
    .getByTestId('mark-not-qualified')
    .getByRole('button', { name: 'Mark Not Qualified' })
    .click();
  await expect(page.getByTestId('card-lead-details')).toContainText('Not Qualified');
  await expect(
    page.getByTestId('card-quick-actions').getByRole('button', { name: 'Mark Not Qualified' }),
  ).toBeDisabled();
});

test('a Begin Online lead shows its request on the Overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${url}/0199b6a5-0000-7000-8000-000000000001`);
  await expect(page.getByTestId('lead-name')).toHaveText('Avery Sample');
  await expect(page.getByTestId('card-contact')).toBeVisible();
  await expect(page.getByTestId('begin-online-request')).toContainText('Annual Tax · 2025');
});

test('the Overview fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(lead(3));
  await expect(page.getByTestId('card-quick-actions')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
