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

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 synthetic'),
});

test('C6 Create Task: Browse Files and drop; wrong type and over 10 MB are named; saves with its files', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  const browse = page.getByRole('button', { name: 'Browse Files' });
  const note = page.getByTestId('attachment-note');
  await expect(browse).toBeDisabled();
  await expect(note).toContainText('Choose the client first');
  await fillRequired(page, 'Collect the W-2s');
  await page.getByLabel('Task type').selectOption({ label: 'Bookkeeping' });
  // Riley Example has no open service: files cannot go to their documents yet.
  await expect(note).toContainText('Riley Example has no open service');
  await expect(browse).toBeDisabled();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Jamie Sample' });
  await expect(browse).toBeEnabled();
  await expect(note).toHaveText(
    "Saved privately to Jamie Sample's documents under Bookkeeping (Growth), staff only.",
  );

  const chooser = page.waitForEvent('filechooser');
  await browse.click();
  await (
    await chooser
  ).setFiles([
    pdf('w2-2025.pdf'),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') },
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024, 1) },
  ]);
  const queued = page.getByTestId('queued-files');
  await expect(queued).toContainText('w2-2025.pdf');
  await expect(queued.getByRole('alert')).toHaveCount(2);
  await expect(queued).toContainText('Upload a PDF, JPG, PNG, Excel (.xlsx) or Word (.docx) file.');
  await expect(queued).toContainText('This file is larger than 10 MB. Choose a smaller file.');

  // Refused files block the save until removed; the entries stay.
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Remove the files marked in red, or choose others.')).toBeVisible();
  await expect(page.getByLabel('Task Name *')).toHaveValue('Collect the W-2s');
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await page.getByRole('button', { name: 'Remove scan.pdf' }).click();

  const dropped = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(
      new File(['%PDF-1.4 synthetic'], 'bank-statement.pdf', { type: 'application/pdf' }),
    );
    return d;
  });
  await page.getByTestId('attachment-drop').dispatchEvent('drop', { dataTransfer: dropped });
  await expect(queued).toContainText('bank-statement.pdf');
  await expect(queued).toContainText('uploads when the task is saved');

  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('detail-attachments').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('detail-attachments')).toContainText('Staff only');

  // Edit Task: a file attaches at once, and Save Changes still saves (no version conflict).
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await expect(page.getByTestId('attached-files').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Browse Files' })).toBeEnabled();
  await page.getByTestId('attachment-input').setInputFiles([pdf('engagement-letter.pdf')]);
  await expect(page.getByText('File attached.')).toBeVisible();
  await expect(page.getByTestId('attached-files').getByRole('listitem')).toHaveCount(3);
  await page.getByLabel('Task Name *').fill('Collect the W-2s and the 1099s');
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-title')).toHaveText('Collect the W-2s and the 1099s');
  await expect(page.getByTestId('detail-attachments').getByRole('listitem')).toHaveCount(3);
});

test('C4 Client: search by part of a name, choose, clear, search for another', async ({ page }) => {
  await page.goto(`${base}/new`);
  const client = page.getByLabel('Client', { exact: true });
  const search = page.getByTestId('client-search');
  await search.fill('jam');
  await expect(client.locator('option', { hasText: 'Jamie Sample' })).toHaveCount(1);
  await expect(client.locator('option', { hasText: 'Riley Example' })).toHaveCount(0);
  await client.selectOption({ label: 'Jamie Sample' });
  await expect(page.getByTestId('form-summary')).toContainText('Jamie Sample');
  await client.selectOption('');
  await expect(page.getByTestId('form-summary')).not.toContainText('Jamie Sample');
  await search.fill('riley');
  await expect(client.locator('option', { hasText: 'Riley Example' })).toHaveCount(1);
  await client.selectOption({ label: 'Riley Example' });
  // A choice keeps its name when the search changes.
  await search.fill('zzzz-no-such-client');
  await expect(client.locator('option').first()).toHaveText('No clients match');
  await expect(client.locator('option:checked')).toHaveText('Riley Example');
});

test('C5 Related To: the chosen client open engagements; a client change clears it', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  const related = page.getByLabel('Related to');
  await expect(related).toBeDisabled();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Jamie Sample' });
  await expect(related.locator('option', { hasText: 'Bookkeeping (Growth) (open)' })).toHaveCount(
    1,
  );
  await expect(related.locator('option', { hasText: '2024 Personal Tax' })).toHaveCount(0);
  await related.selectOption({ label: 'Bookkeeping (Growth) (open)' });
  await expect(page.getByTestId('form-summary')).toContainText('Bookkeeping (Growth)');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Riley Example' });
  await expect(related).toHaveValue('');
  await expect(related.locator('option').first()).toHaveText('No open engagement for this client');
  await expect(page.getByTestId('form-summary')).not.toContainText('Bookkeeping (Growth)');
});

test('C7 All Day sits with Due Time; the rule and the summary follow it', async ({ page }) => {
  await page.goto(`${base}/new`);
  const allDay = page.getByLabel('All Day');
  const time = page.locator('#tf-time');
  await expect(allDay).toBeChecked();
  await expect(page.getByTestId('due-rule')).toContainText(
    'All day: due by the end of the due date.',
  );
  await page.locator('#tf-due').fill('2027-03-02');
  await expect(time).toBeDisabled();
  await expect(page.getByTestId('form-summary')).toContainText('Mar 2, 2027');
  await allDay.uncheck();
  await expect(time).toBeEnabled();
  await time.selectOption('14:30');
  await expect(page.getByTestId('due-rule')).toContainText('Due at that time on the due date.');
  await expect(page.getByTestId('due-rule')).toContainText('time zone');
  await expect(page.getByTestId('form-summary')).toContainText('Mar 2, 2027 at 2:30 PM');
});

test('C8 Apply the same checklist: usable once there is a step; each occurrence gets a copy', async ({
  page,
}) => {
  await page.goto(`${base}/recurring/new`);
  const apply = page.getByLabel('Apply the same checklist to all occurrences');
  const note = page.getByTestId('rec-checklist-note');
  await expect(apply).toBeDisabled();
  await expect(note).toHaveText('Add a checklist item to apply it to every occurrence.');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Reconcile the bank feed');
  await page.getByRole('checkbox', { name: 'Required' }).check();
  await expect(apply).toBeEnabled();
  await expect(apply).toBeChecked();
  await expect(note).toContainText('Each occurrence gets its own copy');
  await apply.uncheck();
  await expect(note).toHaveText('Occurrences start without a checklist.');
  await apply.check();
  await page.getByLabel('Task Name *').fill('Monthly bank review');
  await page.getByLabel('Task Type *').selectOption({ label: 'Bookkeeping' });
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Assign To *').selectOption({ index: 1 });
  await page.getByTestId('series-save').click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/[0-9a-f-]{36}$/);
});

test('C10 Unsaved changes: Keep Editing, Discard, and Save from Cancel and Back', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  // Nothing typed: Cancel leaves at once.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole('link', { name: 'Add Task', exact: true }).first().click();
  await page.getByLabel('Task Name *').fill('Call about the extension');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('unsaved-keep').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Task Name *')).toHaveValue('Call about the extension');
  // A link (Back to Tasks) asks too; Save with missing fields stays and says what to fix.
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('unsaved-save').click();
  await expect(page.getByText('Choose a client', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  // Discard leaves without saving.
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByTestId('unsaved-discard').click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await page.getByLabel('Search tasks').fill('Call about the extension');
  await expect(page.getByTestId('task-table').getByTestId('task-link')).toHaveCount(0);

  // The template editor asks the same.
  await page.getByRole('tab', { name: 'Task Templates' }).click();
  await page.getByTestId('create-template').click();
  await page.getByLabel('Template Name *').fill('Unsaved template');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('unsaved-discard').click();
  await expect(page).toHaveURL(/\/tasks\?view=templates$/);
});

test('C11 Duplicate a checklist item: a separate copy below it, kept in order on save', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  await fillRequired(page, 'Prepare the payroll filing');
  await page.getByLabel('Task type').selectOption({ label: 'Bookkeeping' });
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Collect the timesheets');
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 2').fill('File the return');
  await page.getByRole('button', { name: 'Duplicate item 1' }).click();
  await expect(page.getByLabel('Checklist item 2')).toHaveValue('Collect the timesheets');
  await expect(page.getByLabel('Checklist item 3')).toHaveValue('File the return');
  await page.getByLabel('Checklist item 2').fill('Collect the contractor invoices');
  await expect(page.getByLabel('Checklist item 1')).toHaveValue('Collect the timesheets');
  await page.getByRole('button', { name: 'Move item 3 up' }).click();
  await expect(page.getByLabel('Checklist item 2')).toHaveValue('File the return');
  await page.getByRole('button', { name: 'Delete item 2' }).click();
  await expect(page.getByLabel('Checklist item 2')).toHaveValue('Collect the contractor invoices');
  await page.getByTestId('task-save').click();
  const list = page.getByTestId('detail-checklist');
  await expect(list).toContainText('Collect the timesheets');
  await expect(list).toContainText('Collect the contractor invoices');
  await expect(list).not.toContainText('File the return');
});

test('A3 Custom reminders: any days and a time; alike or late ones are refused; kept on Edit', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  await fillRequired(page, 'File the quarterly estimate');
  await page.getByLabel('Task type').selectOption({ label: 'Bookkeeping' });
  await page.getByLabel('All Day').uncheck();
  await page.locator('#tf-time').selectOption('14:30');
  await page.getByLabel('Enable reminders').check();
  const first = page.getByLabel('Reminder 1', { exact: true });
  await expect(first.locator('option', { hasText: 'Custom…' })).toHaveCount(1);
  await first.selectOption('custom');
  await page.getByLabel('Reminder 1 days before').fill('');
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Enter 0 to 365 days before the due date.')).toBeVisible();
  await page.getByLabel('Reminder 1 days before').fill('10');
  await page.getByLabel('Reminder 1 time').selectOption('09:00');

  // A second one alike is refused.
  await page.getByRole('button', { name: 'Add Reminder' }).click();
  await page.getByLabel('Reminder 2', { exact: true }).selectOption('custom');
  await page.getByLabel('Reminder 2 days before').fill('10');
  await page.getByLabel('Reminder 2 time').selectOption('09:00');
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Two reminders are the same. Remove one.')).toBeVisible();

  // Same day after the due time is refused.
  await page.getByLabel('Reminder 2 days before').fill('0');
  await page.getByLabel('Reminder 2 time').selectOption('18:00');
  await page.getByTestId('task-save').click();
  await expect(page.getByText('A same-day reminder cannot be after the due time.')).toBeVisible();
  await page.getByLabel('Reminder 2 time').selectOption('08:00');
  await page.getByTestId('task-save').click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const shown = page.getByTestId('detail-reminders');
  await expect(shown).toContainText('10 days before, at 9:00 AM');
  await expect(shown).toContainText('Same day, at 8:00 AM');
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Reminder 1', { exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('Reminder 1 days before')).toHaveValue('10');
  await expect(page.getByLabel('Reminder 1 time')).toHaveValue('09:00');
});

test('A5 Recurring Save & Create Another: saved once, a fresh form says so', async ({ page }) => {
  await page.goto(`${base}/recurring/new`);
  await page.getByLabel('Task Name *').fill('Monthly sales tax filing');
  await page.getByLabel('Task Type *').selectOption({ label: 'Compliance' });
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Assign To *').selectOption({ index: 1 });
  await page.getByTestId('series-save-another').dblclick();
  await expect(
    page.getByText('Monthly sales tax filing saved. Set up the next one.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/recurring\/new$/);
  await expect(page.getByLabel('Task Name *')).toHaveValue('');
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'Recurring Tasks' }).click();
  await expect(
    page.getByTestId('series-rows').getByRole('link', { name: 'Monthly sales tax filing' }),
  ).toHaveCount(1);
});

test('T2 A double click on Save makes one task', async ({ page }) => {
  await page.goto(`${base}/new`);
  await fillRequired(page, 'Send the engagement renewal');
  await page.getByLabel('Task type').selectOption({ label: 'Onboarding' });
  await page.getByTestId('task-save').dblclick();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await page.getByLabel('Search tasks').fill('Send the engagement renewal');
  await expect(page.getByTestId('task-table').getByTestId('task-link')).toHaveCount(1);
});
