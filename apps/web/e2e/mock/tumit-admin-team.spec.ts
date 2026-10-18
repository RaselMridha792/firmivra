import { expect, test, type Page } from '@playwright/test';

// Super Admin Team (S05) in mock mode: the adminTeam mock (mocks/admin-team.ts), signed in as
// Morgan Admin, the CEO / Owner at authority level 1. Each test starts from the seeded team.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

async function openTeam(page: Page) {
  await page.goto(admin('/team'));
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await expect(page.getByTestId('member-card').first()).toBeVisible();
}

test('the directory opens with its totals, cards and list, and filters by department', async ({
  page,
}) => {
  await openTeam(page);
  await expect(page.getByTestId('kpi-members-value')).toHaveText('15');
  await expect(page.getByTestId('kpi-admins-value')).toHaveText('10');
  await expect(page.getByTestId('kpi-standard-value')).toHaveText('5');
  await expect(page.getByTestId('kpi-active-value')).toHaveText('73%');
  await expect(page.getByTestId('member-card')).toHaveCount(12);
  await expect(page.getByText('Showing 1–12 of 15 team members')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Morgan Admin' })).toContainText('Owner / CEO');

  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Revenue / Sales' });
  await expect(page.getByTestId('member-card')).toHaveCount(5);
  await page.getByLabel('Search team members').fill('marcus');
  await expect(page.getByTestId('member-card')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Marcus Webb' })).toContainText('Sales Manager');

  await page.getByRole('button', { name: 'List View' }).click();
  const table = page.getByRole('table', { name: 'Team members' });
  await expect(table.getByRole('columnheader', { name: 'Permission Level' })).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('Charlotte, NC');
});

test('a member gets a message, and the selection changes status', async ({ page }) => {
  await openTeam(page);
  await page.getByRole('button', { name: 'Message Hannah Cole' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Message' });
  await expect(dialog.getByText('Hannah Cole')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(dialog.getByText('Enter a subject')).toBeVisible();
  await dialog.getByLabel('Subject').fill('Quarterly onboarding review');
  await dialog.getByRole('textbox', { name: 'Message' }).fill('Please send your notes by Friday.');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message sent to 1 team member.')).toBeVisible();

  await page.getByLabel('Select Leo Martins').check();
  await expect(page.getByTestId('selected-count')).toHaveText('1 selected');
  await page.getByRole('button', { name: 'Change Status' }).click();
  const status = page.getByRole('dialog', { name: 'Change Status' });
  await status.getByLabel('Status').selectOption({ label: 'Suspended' });
  await status.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Updated 1 team member.')).toBeVisible();
  await expect(page.getByTestId('kpi-active-value')).toHaveText('67%');
});

test('Team Communication sends to a department through every channel', async ({ page }) => {
  await openTeam(page);
  await page.getByRole('button', { name: 'Team Communication' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Message' });
  await dialog.getByLabel('Department', { exact: true }).check();
  await dialog.getByLabel('Select Department').fill('people');
  await dialog.getByRole('button', { name: /Human Resources \/ People/ }).click();
  await dialog.getByLabel('Subject').fill('Benefits enrollment');
  await dialog.getByRole('textbox', { name: 'Message' }).fill('Enrollment closes next week.');
  await dialog.getByLabel('Send Through All Channels').check();
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText(/Message sent to 2 team members\./)).toBeVisible();
});

test('Team fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTeam(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'List View' }).click();
  await expect(page.getByRole('table', { name: 'Team members' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
