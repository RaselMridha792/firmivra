import { expect, test, type Page } from '@playwright/test';

// R56: Octavia's Tasks review of Oct 21 (docs/specs/review-2026-10-23/CHANGE-LIST.md, section A),
// in mock mode as an Owner. The mock firm has five task types. The mock keeps its data in the
// page, so these tests move between pages by their links: a full load starts the data again.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tasks`;
const TYPES = ['Business Advisory', 'Bookkeeping', 'Tax Preparation', 'Compliance', 'Onboarding'];

async function rowAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Archives every type on Manage Task Types, then opens Create Task by its links. */
async function noActiveTypes(page: Page) {
  await page.goto(`${base}/types`);
  for (const name of TYPES) {
    await rowAction(page, name, 'Archive');
    await expect(page.getByText(`${name} is archived; tasks that have it keep it.`)).toBeVisible();
  }
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('link', { name: 'Add Task', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
}

async function fillRequired(page: Page, title: string) {
  await page.getByLabel('Task Name *').fill(title);
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
}

test('C1 Manage Task Types: add, refuse a taken name, rename, archive and restore', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'More ways to add a task' }).click();
  await page.getByRole('menuitem', { name: 'Manage Task Types' }).click();
  await expect(page.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
  const names = page.getByTestId('task-type-name');
  await expect(names).toHaveCount(5);

  await page.getByTestId('add-task-type').click();
  await page.getByRole('dialog').getByLabel('Name *').fill('Payroll Filing');
  await page.getByTestId('save-task-type').click();
  await expect(page.getByText('Payroll Filing added.')).toBeVisible();
  await expect(names).toHaveCount(6);

  await page.getByTestId('add-task-type').click();
  await page.getByRole('dialog').getByLabel('Name *').fill('bookkeeping');
  await page.getByTestId('save-task-type').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    'Another task type already has this name.',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await rowAction(page, 'Payroll Filing', 'Rename');
  await page.getByRole('dialog').getByLabel('Name *').fill('Payroll Returns');
  await page.getByTestId('save-task-type').click();
  await expect(page.getByText('Payroll Returns saved.')).toBeVisible();

  await rowAction(page, 'Payroll Returns', 'Archive');
  const row = page.getByRole('row', { name: /Payroll Returns/ });
  await expect(row).toContainText('Archived');

  // An archived type leaves the picker of a new task.
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('link', { name: 'Add Task', exact: true }).first().click();
  const options = page.locator('#tf-type option');
  await expect(options.filter({ hasText: 'Bookkeeping' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'Payroll Returns' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('button', { name: 'More ways to add a task' }).click();
  await page.getByRole('menuitem', { name: 'Manage Task Types' }).click();
  await rowAction(page, 'Payroll Returns', 'Restore');
  await expect(page.getByText('Payroll Returns is offered on new tasks again.')).toBeVisible();
  await expect(row).toContainText('Active');
});

test('C1 with no active type: the form says so and the task saves without one', async ({
  page,
}) => {
  await noActiveTypes(page);
  const type = page.getByLabel('Task type');
  await expect(type).toBeDisabled();
  await expect(page.getByTestId('type-note')).toContainText(
    'No task types are set up yet, so the task saves without one.',
  );
  await expect(page.locator('label[for="tf-type"]')).toHaveText('Task Type');

  // Required fields still say what is missing, and keep what was typed.
  await page.getByLabel('Task Name *').fill('Reconcile the escrow account');
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Choose a client', { exact: true })).toBeVisible();
  await expect(page.getByText('Choose a task type')).toHaveCount(0);
  await expect(page.getByLabel('Task Name *')).toHaveValue('Reconcile the escrow account');

  await fillRequired(page, 'Reconcile the escrow account');
  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('task-title')).toHaveText('Reconcile the escrow account');

  // Reopened in Edit, it is the same task, and saves again without a type.
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();
  await expect(page.getByLabel('Task Name *')).toHaveValue('Reconcile the escrow account');
  await page.getByLabel('Task Name *').fill('Reconcile the escrow account (Q4)');
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-title')).toHaveText('Reconcile the escrow account (Q4)');
});

test('C1 Add Task Type from the field selects it, and the field is then required', async ({
  page,
}) => {
  await noActiveTypes(page);
  await page.getByTestId('add-type-inline').click();
  await page.getByRole('dialog').getByLabel('Name *').fill('Advisory Review');
  await page.getByTestId('save-task-type').click();
  await expect(
    page.getByText('Advisory Review added. It is selected for this task.'),
  ).toBeVisible();
  const type = page.getByLabel('Task type');
  await expect(type).toBeEnabled();
  await expect(type.locator('option:checked')).toHaveText('Advisory Review');
  await expect(page.locator('label[for="tf-type"]')).toHaveText('Task Type *');

  await type.selectOption('');
  await fillRequired(page, 'Advisory review for Q1');
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Choose a task type')).toBeVisible();
  await type.selectOption({ label: 'Advisory Review' });
  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('main')).toContainText('Advisory Review');
});

test('C1 Set Up Recurring Task saves without a type when none is set up', async ({ page }) => {
  await noActiveTypes(page);
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('link', { name: 'Add Recurring Task' }).first().click();
  await expect(page.getByLabel('Task type')).toBeDisabled();
  await page.getByLabel('Task Name *').fill('Monthly escrow review');
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Assign To *').selectOption({ index: 1 });
  await page.getByTestId('series-save').click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('series-title')).toHaveText('Monthly escrow review');
});

test('C2 a task saves without a template, and another from one; each is one task', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  await fillRequired(page, 'Standalone payroll check');
  await page.getByLabel('Task type').selectOption({ label: 'Bookkeeping' });
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-title')).toHaveText('Standalone payroll check');

  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'Task Templates' }).click();
  const first = page.getByTestId('template-rows').getByRole('row').first();
  const template = (await first.getByTestId('template-name').textContent()) ?? '';
  await first.getByRole('link', { name: /^Use/ }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
  await fillRequired(page, 'From the template');
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-title')).toHaveText('From the template');
  expect(template).not.toBe('');

  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  const rows = page.getByTestId('task-table').getByTestId('task-link');
  await page.getByLabel('Search tasks').fill('Standalone payroll check');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search tasks').fill('From the template');
  await expect(rows).toHaveCount(1);
});

test('C9 Automations opens the Automations module on the Tasks category, with a way back', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByTestId('tasks-automations').click();
  await expect(page).toHaveURL(/\/automations\?category=TASKS&from=tasks$/);
  await expect(page.getByRole('heading', { name: 'Automation', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('TASKS');
  await expect(page.getByTestId('categories').getByRole('button', { pressed: true })).toContainText(
    'Tasks',
  );
  await page.getByTestId('back-to-tasks').click();
  await expect(page).toHaveURL(/\/tasks$/);
});
