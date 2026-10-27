import { expect, test } from '@playwright/test';

// SH4 (Octavia's Oct 25 review: PY-F04, the Bookkeeping Tasks contract; TX-F13 to F15 for R60):
// Create Task opens Tasks prefilled with the client, the service and its period, with Back to the
// workspace (and a question first when the form has unsaved work); the workspace's task list has
// an inline status and the Tasks module's own action menu. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('Payroll: Create Task is prefilled, Back asks first, and the new task is listed with its status and menu', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  await page.getByTestId('quick-actions').getByRole('link', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?clientId=.+&engagementId=.+&from=/);
  await expect(page.getByLabel('Client', { exact: true }).locator('option:checked')).toHaveText(
    'Green Leaf Café LLC',
  );
  await expect(page.getByLabel('Related to').locator('option:checked')).toHaveText(/Payroll/);

  await page.locator('#tf-title').fill('Fake: collect the Q4 timesheets');
  await page.getByTestId('back-to-origin').click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay on This Page' }).click();
  await page.getByLabel('Task type').selectOption({ index: 1 });
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Save Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}\?from=/);
  // The new task's page keeps Back to the workspace.
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(`${app}/payroll/clients/${GREEN}`);
  const panel = page.getByTestId('panel-tasks');
  await expect(panel.getByRole('link', { name: 'Fake: collect the Q4 timesheets' })).toBeVisible();
  await panel.getByLabel('Status of Fake: collect the Q4 timesheets').selectOption('IN_PROGRESS');
  await expect(page.getByText('Fake: collect the Q4 timesheets: In Progress.')).toBeVisible();

  await panel.getByRole('button', { name: 'Actions for Fake: collect the Q4 timesheets' }).click();
  const menu = page.getByRole('menu');
  for (const name of [
    'View',
    'Edit',
    'Mark as In Progress',
    'Mark Complete',
    'Reassign',
    'Change Due Date',
    'Change Priority',
    'Duplicate',
    'Convert to Recurring',
    'Save as Template',
    'Cancel Task',
    'Archive Task',
  ]) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'Change Priority' }).click();
  await expect(page.getByRole('dialog', { name: 'Change Priority' })).toBeVisible();
  await expect(page).toHaveURL(`${app}/payroll/clients/${GREEN}`);
});

test('Bookkeeping: Create Task carries the current period into the details', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  await page
    .getByRole('link', { name: /Green Leaf/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\//);
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  await expect(page).toHaveURL(/\/tasks\/new\?clientId=.+&period=.+&from=/);
  await expect(page.getByLabel('Description')).toHaveValue(/^For .+\.$/);
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Bookkeeping');
});
