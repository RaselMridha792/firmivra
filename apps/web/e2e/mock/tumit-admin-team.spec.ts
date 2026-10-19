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
  await page.getByLabel('Search team members', { exact: true }).fill('marcus');
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
  await dialog.getByLabel('Subject *', { exact: true }).fill('Quarterly onboarding review');
  await dialog.getByRole('textbox', { name: 'Message' }).fill('Please send your notes by Friday.');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message sent to 1 team member.')).toBeVisible();

  await page.getByLabel('Select Leo Martins', { exact: true }).check();
  await expect(page.getByTestId('selected-count')).toHaveText('1 selected');
  await page.getByRole('button', { name: 'Change Status' }).click();
  const status = page.getByRole('dialog', { name: 'Change Status' });
  await status.getByLabel('Status *', { exact: true }).selectOption({ label: 'Suspended' });
  await status.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Updated 1 team member.')).toBeVisible();
  await expect(page.getByTestId('kpi-active-value')).toHaveText('67%');
});

test('Team Communication sends to a department through every channel', async ({ page }) => {
  await openTeam(page);
  await page.getByRole('button', { name: 'Team Communication' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Message' });
  await dialog.getByLabel('Department', { exact: true }).check();
  await dialog.getByLabel('Select Department', { exact: true }).fill('people');
  await dialog.getByRole('button', { name: /Human Resources \/ People/ }).click();
  await dialog.getByLabel('Subject *', { exact: true }).fill('Benefits enrollment');
  await dialog.getByRole('textbox', { name: 'Message' }).fill('Enrollment closes next week.');
  await dialog.getByLabel('Send Through All Channels', { exact: true }).check();
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

test('Add Team Member loads the role template and adds the person to the team', async ({
  page,
}) => {
  await page.goto(admin('/team/new'));
  await expect(page.getByRole('heading', { name: 'Add Team Member', level: 1 })).toBeVisible();
  const form = page.getByRole('form', { name: 'Add Team Member' });
  await form.getByRole('button', { name: 'Add Team Member' }).click();
  await expect(form.getByText('Enter a first name')).toBeVisible();
  await expect(form.getByText('Choose a department')).toBeVisible();

  await form.getByLabel('First Name *', { exact: true }).fill('Jamie');
  await form.getByLabel('Last Name *', { exact: true }).fill('Rivera');
  await form.getByLabel('Email Address *', { exact: true }).fill('jamie.rivera@example.test');
  await form.getByLabel('Department *', { exact: true }).selectOption({ label: 'Revenue / Sales' });
  await form.getByLabel('Role *', { exact: true }).selectOption({ label: 'Sales Manager' });
  await expect(form.getByTestId('authority-level')).toHaveText('Authority level 4: Manager');
  await expect(form.getByLabel('Reports To', { exact: true }).locator('option:checked')).toHaveText(
    'Priya Raman (VP / Director of Sales)',
  );
  await expect(form.getByRole('checkbox', { name: /^Sales Center/ })).toBeChecked();
  await expect(form.getByText('Custom Permissions Applied')).toHaveCount(0);
  await form.getByRole('checkbox', { name: /^Billing/ }).check();
  await expect(form.getByText('Custom Permissions Applied')).toBeVisible();
  await expect(page.getByTestId('member-review')).toContainText('Sales Manager (level 4)');

  await form.getByRole('button', { name: 'Add Team Member' }).click();
  await expect(page.getByTestId('member-added')).toHaveText(
    'Sales Manager in Revenue / Sales. Status: Pending Invitation.',
  );
  await page.getByRole('link', { name: 'Back to Team' }).click();
  await expect(page).toHaveURL(admin('/team'));
  await page.getByLabel('Search team members', { exact: true }).fill('jamie');
  await expect(page.getByRole('article', { name: 'Jamie Rivera' })).toBeVisible();
});

test('an email already on the team is caught on the email field', async ({ page }) => {
  await page.goto(admin('/team/new'));
  const form = page.getByRole('form', { name: 'Add Team Member' });
  await form.getByLabel('First Name *', { exact: true }).fill('Morgan');
  await form.getByLabel('Last Name *', { exact: true }).fill('Admin');
  await form.getByLabel('Email Address *', { exact: true }).fill('morgan.admin@example.test');
  await form.getByLabel('Department *', { exact: true }).selectOption({ label: 'Product' });
  await form.getByLabel('Role *', { exact: true }).selectOption({ label: 'Product Manager' });
  await form.getByRole('button', { name: 'Add Team Member' }).click();
  await expect(form.getByLabel('Email Address *', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(
    form.getByText('Someone on the team already uses this email address.').first(),
  ).toBeVisible();
});

test('Edit Team Member warns before a new role replaces custom permissions, then saves', async ({
  page,
}) => {
  await page.goto(admin('/team/0199d1a0-7e01-7000-8000-000000000004/edit'));
  await expect(page.getByRole('heading', { name: 'Edit Team Member', level: 1 })).toBeVisible();
  const form = page.getByRole('form', { name: 'Edit Team Member' });
  await expect(form.getByLabel('First Name *', { exact: true })).toHaveValue('Marcus');
  await expect(form.getByLabel('Email Address *', { exact: true })).toBeDisabled();
  await expect(form.getByText('Custom Permissions Applied')).toBeVisible();

  await form.getByLabel('Role *', { exact: true }).selectOption({ label: 'Sales Team Lead' });
  const warning = page.getByRole('dialog', { name: 'Replace custom permissions?' });
  await warning.getByRole('button', { name: 'Load Role Defaults' }).click();
  await expect(form.getByText('Custom Permissions Applied')).toHaveCount(0);
  await expect(form.getByLabel('Job Title', { exact: true })).toHaveValue('Sales Team Lead');
  await form.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Changes to Marcus Webb were saved.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recent activity' })).toContainText(
    'Role changed: Sales Manager → Sales Team Lead',
  );
});

test('the add and edit forms fit a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(admin('/team/new'));
  await expect(page.getByRole('form', { name: 'Add Team Member' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(admin('/team/0199d1a0-7e01-7000-8000-000000000004/edit'));
  await expect(page.getByRole('form', { name: 'Edit Team Member' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
