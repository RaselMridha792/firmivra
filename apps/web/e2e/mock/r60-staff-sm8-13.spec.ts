import { expect, test } from '@playwright/test';

// Octavia's Staff Management review of Oct 23, SM8 to SM13: the summary cards and one directory
// view (SM9), Manage Members on a department (SM13), the Custom Role shortcut with Back (SM11),
// custom schedules and the workload unit (SM8), and the header's date and time (SM10). Mock mode
// (playwright.mock.config.ts) as the Owner; the mock keeps its data in the page. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('the summary cards open the matching list; Manage Staff Accounts opens the one directory', async ({
  page,
}) => {
  await page.goto(app('/team'));
  await page.getByTestId('kpi-active').click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/team\/directory\?status=active$/);
  await expect(page.getByTestId('page-title')).toHaveText('Staff Directory');
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('active');

  await page.getByRole('link', { name: 'Staff Management' }).first().click();
  await page.getByTestId('kpi-inactive').click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('inactive');

  await page.getByRole('link', { name: 'Staff Management' }).first().click();
  await page.getByRole('link', { name: /Manage Staff Accounts/ }).click();
  await expect(page).toHaveURL(/\/team\/directory$/);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('all');

  await page.getByRole('link', { name: 'Staff Management' }).first().click();
  await page.getByTestId('kpi-departments').click();
  await expect(page).toHaveURL(/\/team\/departments$/);
});

test('Manage Members puts staff in a department with no team, and keeps everyone in one', async ({
  page,
}) => {
  await page.goto(app('/team/departments'));
  await page.getByRole('button', { name: 'Actions for Marketing' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Manage Members' }).click();
  let dialog = page.getByRole('dialog', { name: 'Manage Members of Marketing' });
  await dialog.getByLabel('Search staff').fill('Theo');
  await dialog.getByRole('checkbox', { name: /Theo Grant/ }).check();
  await dialog.getByRole('button', { name: 'Save Members' }).click();
  await expect(dialog).toBeHidden();

  // Daniel Okafor is only in Tax: taking him out is refused, naming him.
  await page.getByRole('button', { name: 'Actions for Tax', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage Members' }).click();
  dialog = page.getByRole('dialog', { name: 'Manage Members of Tax' });
  await dialog.getByRole('checkbox', { name: /Daniel Okafor/ }).uncheck();
  await dialog.getByRole('button', { name: 'Save Members' }).click();
  await expect(dialog).toContainText('Daniel Okafor has no other department');
});

test('Create Custom Role from Create Staff, then Back to the same entries with the role there', async ({
  page,
}) => {
  await page.goto(app('/team/new'));
  await page.getByLabel('First Name *').fill('Jordan', { timeout: 60_000 });
  await page.getByLabel('Last Name *').fill('Lee');
  await page.getByTestId('create-custom-role').click();
  await expect(page).toHaveURL(/\/team\/roles\?create=custom&back=/);
  const create = page.getByRole('dialog', { name: 'Create Custom Role' });
  await create.getByLabel('Role Name *').fill('Senior Reviewer');
  await create.getByRole('combobox', { name: 'Start From *' }).selectOption({ label: 'Staff' });
  await create.getByRole('button', { name: 'Next: Set Permissions' }).click();
  await page.getByRole('button', { name: /Save Role/ }).click();

  await page.getByTestId('back-to-staff').click();
  await expect(page).toHaveURL(/\/team\/new\?draft=/);
  await expect(page.getByLabel('First Name *')).toHaveValue('Jordan');
  const role = page.getByRole('combobox', { name: 'Role *' });
  await role.selectOption({ label: 'Senior Reviewer (custom role)' });
  await expect(page.getByText('A custom role based on Staff.')).toBeVisible();
});

test('Additional Details: a custom work schedule and the workload in active clients', async ({
  page,
}) => {
  await page.goto(app('/team/new/details'));
  const schedule = page.getByRole('combobox', { name: 'Work Schedule' });
  await schedule.selectOption({ label: 'Custom schedule…' }, { timeout: 60_000 });
  await page.getByLabel('Custom schedule').fill('Mon-Thu, 10-hour days');
  await expect(page.getByText('A custom schedule is saved for the firm')).toBeVisible();
  await expect(page.getByLabel('Maximum Active Clients (Optional)')).toBeVisible();
  await expect(page.getByText('Client assignment does not check it yet.')).toBeVisible();
});

test('the header shows the date and time with its time zone, on every page', async ({ page }) => {
  for (const path of ['/team', '/settings/overview']) {
    await page.goto(app(path));
    const clock = page.getByTestId('header-clock');
    await expect(clock).toBeVisible({ timeout: 60_000 });
    await expect(clock).toContainText(/\d{4}/);
    await expect(clock).toContainText(/\d{1,2}:\d{2}\s?(AM|PM)/);
    await expect(clock).toHaveAttribute('title', /^Time zone: /);
  }
});
