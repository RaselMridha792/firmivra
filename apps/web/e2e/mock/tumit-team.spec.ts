import { expect, test } from '@playwright/test';

// Staff Management (/team) and Terms & Privacy in mock mode, as an owner. The Staff Management
// mock (mocks/staff-management.ts) has 11 synthetic people: 8 active, Iris Novak locked, Sam
// Whitley invited, Victor Lane deactivated; 7 departments, Human Resources inactive.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Staff Management shows the cards, the tiles and the directory', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team'));
  await expect(page.getByTestId('page-title')).toHaveText('Staff Management');

  const value = (id: string) => page.getByTestId(`kpi-${id}`).getByTestId('kpi-value');
  await expect(value('total')).toHaveText('11');
  await expect(value('active')).toHaveText('8');
  await expect(page.getByTestId('kpi-active')).toContainText('73% active');
  await expect(value('inactive')).toHaveText('1');
  await expect(page.getByTestId('kpi-inactive')).toContainText('9% inactive');
  await expect(value('departments')).toHaveText('6');

  // Every tile opens its page; Create Staff and Add Staff open step 1 of the wizard.
  const links = page.getByTestId('staff-links');
  for (const [name, href] of [
    ['Create Staff Account', '/team/new'],
    ['Manage Staff Accounts', '/team/directory'],
    ['Roles & Permissions', '/team/roles'],
    ['Teams & Departments', '/team/departments'],
    ['Activity & Login History', '/team/activity'],
    ['Bulk Upload Staff', '/team/import'],
    ['Staff Settings', '/team/settings'],
    ['Reports', '/reports'],
  ] as const) {
    await expect(links.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
      'href',
      href,
    );
  }

  const names = page.getByTestId('staff-name');
  await expect(names).toHaveCount(10);
  await expect(page.getByText('Showing 1 – 10 of 11 staff members')).toBeVisible();
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('Morgan Avery')).toContainText('Owner / CEO');
  await expect(row('Morgan Avery')).toContainText('Administration');
  await expect(row('Morgan Avery').getByTestId('staff-role')).toHaveText('Owner');
  await expect(row('Morgan Avery').getByTestId('staff-status')).toHaveText('Active');

  await page.getByTestId('add-staff').click();
  await expect(page).toHaveURL(app('/team/new'), { timeout: 60_000 });
  await page.goBack();
  await links.getByRole('link', { name: /^Create Staff Account/ }).click();
  await expect(page).toHaveURL(app('/team/new'), { timeout: 60_000 });
});

test('the directory filters, and the row menu acts as the status allows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team'));
  const names = page.getByTestId('staff-name');
  await expect(names).toHaveCount(10);

  await page.getByLabel('Status', { exact: true }).selectOption('inactive');
  await expect(names).toHaveCount(1);
  await expect(names.first()).toContainText('Victor Lane');
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Payroll' });
  await expect(names).toHaveCount(2);
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'All Departments' });
  await page.getByLabel('Search staff').fill('whitley');
  await expect(names).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Sam Whitley' })).toContainText('Invited');

  // The invited person: resend (the old page's Resend invite).
  await page.getByRole('button', { name: 'Actions for Sam Whitley' }).click();
  await expect(page.getByRole('menuitem', { name: 'Revoke Invitation' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Lock Account' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Resend Invitation' }).click();
  await expect(page.getByTestId('staff-result')).toHaveText(
    'A fresh invitation was emailed to Sam Whitley.',
  );

  // An active person: deactivate asks first, then the row and the cards follow.
  await page.getByLabel('Search staff').fill('');
  await expect(names).toHaveCount(10);
  await page.getByRole('button', { name: 'Actions for Marcus Bell' }).click();
  await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Deactivate Account');
  await dialog.getByRole('button', { name: 'Deactivate Account' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('staff-result')).toContainText('Marcus Bell’s access has ended.');
  await expect(
    page.getByRole('row').filter({ hasText: 'Marcus Bell' }).getByTestId('staff-status'),
  ).toHaveText('Inactive');
  await expect(page.getByTestId('kpi-inactive').getByTestId('kpi-value')).toHaveText('2');

  // The signed-in owner's own row opens their pages but changes nothing.
  await page.getByRole('button', { name: 'Actions for Morgan Avery' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'View Profile',
    'Permissions',
    'Security',
    'Activity',
  ]);
  await page.keyboard.press('Escape');

  // Account Access & Security asks whose page, or opens the one ticked person's.
  const security = page.getByRole('button', { name: /^Account Access & Security/ });
  await security.click();
  await expect(dialog).toContainText('Choose the staff member');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('row').filter({ hasText: 'Priya Ramos' }).getByRole('checkbox').check();
  await security.click();
  // A route not yet compiled in `next dev` can take a while on its first visit.
  await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\/security$/, { timeout: 60_000 });
});

test('Staff Management has no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/team'));
  await expect(page.getByTestId('staff-name').first()).toBeVisible();
  await expect(page.getByTestId('kpi-total').getByTestId('kpi-value')).toHaveText('11');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('an owner publishes a new Terms version and reads an older one', async ({ page }) => {
  await page.goto(app('/settings/legal'));
  await expect(page.getByTestId('page-title')).toHaveText('Terms & Privacy');
  await expect(page.getByTestId('legal-current').first()).toContainText('version 2');
  await page.getByLabel('New version').first().fill('Sample terms, version 3.');
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByTestId('legal-current').first()).toHaveText('Sample terms, version 3.');

  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample terms for testing.');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('tab', { name: 'Privacy Policy' }).click();
  await expect(page.getByRole('button', { name: 'Publish version 2' })).toBeVisible();
});
