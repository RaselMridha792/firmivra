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

test('C3 Create Task Template in the library, Use it, Edit its source; the task made keeps its start', async ({
  page,
}) => {
  await page.goto(`${base}?view=templates`);
  await expect(page.getByRole('tab', { name: 'Task Templates' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByTestId('create-template').click();
  await expect(page.getByRole('heading', { name: 'Create Task Template' })).toBeVisible();

  // Required name, a taken name on the field, entries kept.
  await page.getByTestId('template-save').click();
  await expect(page.getByText('Enter the template name')).toBeVisible();
  await page.getByLabel('Template Name *').fill('new client onboarding');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-basic').getByRole('alert')).toContainText(
    'Another template already has this name',
  );
  await expect(page.getByLabel('Template Name *')).toHaveValue('new client onboarding');

  await page.getByLabel('Template Name *').fill('Quarterly payroll review');
  await page.locator('#tt-type').selectOption({ label: 'Bookkeeping' });
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Due Date (days after the task is made)').fill('10');
  await page.getByLabel('Assign to').selectOption('SPECIFIC_USER');
  await page.locator('#tt-assignee').selectOption({ index: 1 });
  const member = (await page.locator('#tt-assignee').locator('option:checked').textContent()) ?? '';
  await page.getByLabel('Visible to client by default').check();
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Collect payroll registers');
  await page.getByRole('checkbox', { name: 'Required' }).check();
  await page.getByLabel('Enable reminders').check();
  await expect(page.getByTestId('template-summary')).toContainText(
    '10 days after the task is made',
  );
  await page.getByTestId('template-save').click();

  // Back in the library, named.
  await expect(page).toHaveURL(/\/tasks\?view=templates&saved=[0-9a-f-]{36}$/);
  await expect(
    page.getByText('Quarterly payroll review saved. Use starts a task from it.'),
  ).toBeVisible();
  const row = page
    .getByTestId('template-rows')
    .getByRole('row', { name: /Quarterly payroll review/ });
  await expect(row).toContainText('High');
  await expect(row).toContainText('1 item');

  // Use: the new task starts with every default.
  await row.getByRole('link', { name: /^Use/ }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
  await expect(page.getByLabel('Checklist item 1')).toHaveValue('Collect payroll registers');
  await expect(page.getByLabel('Priority', { exact: true })).toHaveValue('HIGH');
  await expect(page.locator('#tf-type option:checked')).toHaveText('Bookkeeping');
  await expect(page.getByLabel('Assigned to').locator('option:checked')).toHaveText(member);
  await expect(page.getByLabel('Visible to client (optional)')).toBeChecked();
  await expect(page.getByLabel('Reminder 1', { exact: true })).toHaveValue('1');
  await expect(page.locator('#tf-due')).not.toHaveValue('');
  await page.getByLabel('Task Name *').fill('Q1 payroll review for Jamie');
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-title')).toHaveText('Q1 payroll review for Jamie');
  const made = page.url();

  // Edit the source: a new default, one more step.
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'Task Templates' }).click();
  await row.getByRole('link', { name: /^Edit/ }).click();
  await expect(page.getByRole('heading', { name: 'Edit Task Template' })).toBeVisible();
  await expect(page.getByLabel('Template Name *')).toHaveValue('Quarterly payroll review');
  await expect(page.getByLabel('Checklist item 1')).toHaveValue('Collect payroll registers');
  await page.getByLabel('Priority').selectOption('LOW');
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 2').fill('Check the quarterly filings');
  await page.getByTestId('template-save').click();
  await expect(row).toContainText('Low');
  await expect(row).toContainText('2 items');

  // Reopened, the source has the change; Use starts with it.
  await row.getByRole('link', { name: /^Edit/ }).click();
  await expect(page.getByLabel('Checklist item 2')).toHaveValue('Check the quarterly filings');
  await page.getByRole('link', { name: 'Use Template' }).click();
  await expect(page.getByLabel('Priority', { exact: true })).toHaveValue('LOW');
  await expect(page.getByLabel('Checklist item 2')).toHaveValue('Check the quarterly filings');

  // The task made before keeps what it started with.
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await page.getByLabel('Search tasks').fill('Q1 payroll review');
  await page.getByTestId('task-table').getByTestId('task-link').first().click();
  await expect(page).toHaveURL(made);
  await expect(page.getByTestId('detail-checklist')).toContainText('Collect payroll registers');
  await expect(page.getByTestId('detail-checklist')).not.toContainText(
    'Check the quarterly filings',
  );
});

test('C3 a template from a task (Save as Template) still works, and /tasks/templates opens the library', async ({
  page,
}) => {
  await page.goto(`${base}/templates`);
  await expect(page).toHaveURL(/\/tasks\?view=templates$/);
  await expect(page.getByTestId('templates-tab')).toBeVisible();
  await page.getByRole('link', { name: 'Add Task', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
  await page.getByRole('button', { name: 'Save as Template' }).click();
  await page.getByLabel('Template name').fill('From the form');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Template' }).click();
  await expect(page.getByText('Template saved.')).toBeVisible();
});

test('Templates: Duplicate and Archive from the row menu, Restore from Archived', async ({
  page,
}) => {
  await page.goto(`${base}?view=templates`);
  const rows = page.getByTestId('template-rows').getByRole('row');
  await expect(rows.first()).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Bank Account Setup' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Template duplicated.')).toBeVisible();
  await expect(
    page.getByTestId('template-name').filter({ hasText: 'Bank Account Setup (Copy)' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'More actions for Bank Account Setup (Copy)' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('Bank Account Setup (Copy) archived.')).toBeVisible();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: /^Restore Bank Account Setup \(Copy\)/ }).click();
  await expect(page.getByText('Bank Account Setup (Copy) restored.')).toBeVisible();
});
