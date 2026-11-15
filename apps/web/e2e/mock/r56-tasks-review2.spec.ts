import { expect, type Locator, type Page, test } from '@playwright/test';

// R56: Octavia's Tasks Review Two, batch 1 (records/lists/tasks.md: T-C04 to T-C13, T-D03,
// T-D04), in mock mode as an Owner. The mock keeps its data in the page, so these tests move
// between pages by their links: a full load starts the data again. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tasks`;

/** T-C04: the Task Type dropdown: open it and choose a type (the first by default). */
async function chooseType(page: Page, name?: string) {
  await page.getByLabel('Task type').click();
  const list = page.getByRole('listbox', { name: 'Task types' });
  await (
    name ? list.getByRole('option', { name, exact: true }) : list.getByRole('option').nth(1)
  ).click();
}

/** T-C09: the Client combobox: type, then choose from the list under it (the first by default). */
async function chooseClient(page: Page, name?: string) {
  const box = page.getByRole('combobox', { name: 'Client' });
  await box.click();
  await box.fill(name ? name.split(' ')[0]!.toLowerCase() : '');
  const list = page.getByRole('listbox', { name: 'Clients' });
  await (name ? list.getByRole('option', { name }) : list.getByRole('option').first()).click();
}

/** The palette a button wears (T-C07): primary is filled, outline and danger are bordered. */
async function tone(button: Locator): Promise<string> {
  const cls = (await button.getAttribute('class')) ?? '';
  if (cls.includes('bg-action')) return 'primary';
  if (cls.includes('border-action')) return 'outline';
  if (cls.includes('border-danger')) return 'danger';
  return 'secondary';
}

async function openCreate(page: Page) {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible({ timeout: 60_000 });
}

test('T-C07: the task forms use the palette: Save primary, Template and Draft outline, Cancel secondary', async ({
  page,
}) => {
  await openCreate(page);
  expect(await tone(page.getByTestId('task-save'))).toBe('primary');
  expect(await tone(page.getByTestId('task-save-draft'))).toBe('outline');
  expect(await tone(page.getByTestId('task-save-another'))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Save as Template' }))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Cancel' }))).toBe('secondary');

  await page.goto(`${base}/recurring/new`);
  await expect(page.getByTestId('series-save')).toBeVisible({ timeout: 60_000 });
  expect(await tone(page.getByTestId('series-save'))).toBe('primary');
  expect(await tone(page.getByRole('button', { name: 'Save as Template' }))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Cancel' }))).toBe('secondary');
});

test('T-C05: Save & Create Another saves, then opens a clean form that says what was saved', async ({
  page,
}) => {
  await openCreate(page);
  await page.getByLabel('Task Name *').fill('Collect the 1099s');
  await chooseType(page, 'Tax Preparation');
  await chooseClient(page);
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Ask the client');
  await page.getByTestId('task-save-another').click();
  await expect(page.getByText('Task saved: Collect the 1099s. Add another.')).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByLabel('Task Name *')).toHaveValue('');
  await expect(page.getByLabel('Task type')).toHaveText('Select task type');
  await expect(page.getByRole('combobox', { name: 'Client' })).toHaveValue('');
  await expect(page.getByLabel('Checklist item 1')).toHaveCount(0);
  await expect(page.locator('#tf-due')).toHaveValue('');
});

test('T-C08: the Actions column stays on screen while the task table scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 900 });
  await page.goto(base);
  const table = page.getByTestId('task-table');
  const menu = table.getByRole('button', { name: /^Actions for / }).first();
  await expect(menu).toBeVisible({ timeout: 60_000 });
  const scroller = table.locator('.overflow-x-auto').first();
  const wide = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(wide).toBe(true);
  for (const left of [0, 10_000]) {
    await scroller.evaluate((el, x) => (el.scrollLeft = x), left);
    const area = (await scroller.boundingBox())!;
    const b = (await menu.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
    expect(b.x).toBeGreaterThanOrEqual(area.x);
  }
  await expect(menu.locator('xpath=ancestor::td[1]')).toHaveCSS('position', 'sticky');
});

test('T-C13: Archive asks first; the Archived tab lists the task with View and Restore only; Restore brings it back', async ({
  page,
}) => {
  await page.goto(base);
  const link = page.getByTestId('task-table').getByTestId('task-link').first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  const title = (await link.innerText()).trim();
  await link.click();
  await page
    .getByRole('group', { name: 'Task actions' })
    .getByRole('button', { name: 'Archive' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Archive this task?' });
  await expect(confirm).toContainText('Restore brings it back');
  await confirm.getByRole('button', { name: 'Archive Task' }).click();
  await expect(page).toHaveURL(/\/tasks\?view=archived$/);
  await expect(page.getByRole('tab', { name: 'Archived' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const row = page.getByTestId('task-table').getByRole('row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await page.getByRole('button', { name: `Actions for ${title}` }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['View', 'Restore']);
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByText(`${title} restored.`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await expect(page.getByTestId('task-table')).toContainText(title);
});

test('T-C12: Mark Complete is greyed out with the reason while a required checklist item is open', async ({
  page,
}) => {
  await page.goto(`${base}/0199c0f0-0a10-7000-8000-000000000001`);
  await expect(page.getByTestId('checklist-progress')).toContainText('1 of 3 done', {
    timeout: 60_000,
  });
  const title = (await page.getByTestId('task-title').innerText()).trim();
  await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Tasks', exact: true }).first().click();
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await page.getByRole('button', { name: `Actions for ${title}` }).click();
  const complete = page.getByRole('menuitem', { name: /Mark Complete/ });
  await expect(complete).toBeDisabled();
  await expect(complete).toContainText('1 required checklist item is open');
});

test('T-C06: a task’s file opens its document, and is shown, hidden or removed from the task', async ({
  page,
}) => {
  await openCreate(page);
  await page.getByLabel('Task Name *').fill('File the engagement letter');
  await chooseType(page, 'Bookkeeping');
  await chooseClient(page, 'Jamie Sample');
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse Files' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') },
  ]);
  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const files = page.getByTestId('detail-attachments');
  const file = files.getByRole('listitem');
  await expect(file).toHaveCount(1);
  const name = (await file.getByRole('link').innerText()).trim();
  await expect(file.getByRole('link')).toHaveAttribute('href', /^\/documents\/[0-9a-f-]{36}/);
  await expect(file.getByRole('button', { name: 'Download' })).toBeEnabled();
  await file.getByRole('button', { name: 'Show to Client' }).click();
  await expect(page.getByText(`${name} is visible to the client now.`)).toBeVisible();
  await expect(file).toContainText('Visible to client');
  await file.getByRole('button', { name: 'Make Staff Only' }).click();
  await expect(file).toContainText('Staff only');
  await file.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(page.getByText(`${name} removed from the task`)).toBeVisible();
  await expect(files).toContainText('No attachments.');
});

test('T-D04: View Related Record opens the task’s record; a bulk Complete names each skipped task and why', async ({
  page,
}) => {
  await page.goto(`${base}?view=all`);
  const table = page.getByTestId('task-table');
  await expect(table.getByTestId('task-link').first()).toBeVisible({ timeout: 60_000 });
  const blocked = 'Prepare business plan draft';
  await page.getByRole('button', { name: `Actions for ${blocked}` }).click();
  await expect(page.getByRole('menuitem', { name: 'View Related Record' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The business plan has a required step open; another open task completes.
  const other = (await table.getByTestId('task-link').nth(0).innerText()).trim();
  const second =
    other === blocked ? (await table.getByTestId('task-link').nth(1).innerText()).trim() : other;
  for (const title of [blocked, second])
    await table.getByRole('row').filter({ hasText: title }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  const toast = page.getByRole('status').filter({ hasText: 'skipped' });
  await expect(toast).toContainText(/\d completed, \d skipped: /);
  await expect(toast).toContainText(`${blocked} (required checklist items are open)`);

  await page.getByRole('button', { name: `Actions for ${blocked}` }).click();
  await page.getByRole('menuitem', { name: 'View Related Record' }).click();
  await expect(page).toHaveURL(
    /\/business-advisory\/clients\/0199c0f1-a200-7000-8000-000000000001/,
  );
});

test('T-C09: the Client field is one combobox: searching, then the matches or "No clients match", Enter chooses', async ({
  page,
}) => {
  await openCreate(page);
  const client = page.getByRole('combobox', { name: 'Client' });
  const list = page.getByRole('listbox', { name: 'Clients' });
  await client.fill('zzzz-no-such-client');
  // While the search runs it says so; "No clients match" only once it has answered.
  await expect(list).toContainText('Searching…');
  await expect(list).not.toContainText('No clients match');
  await expect(list).toContainText('No clients match');
  await client.fill('jam');
  await expect(list.getByRole('option', { name: 'Jamie Sample' })).toBeVisible();
  await client.press('Enter');
  await expect(client).toHaveValue('Jamie Sample');
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('form-summary')).toContainText('Jamie Sample');
});

test('T-C04: each Task Type in the dropdown has Edit and Delete; Delete asks, and the type leaves the list', async ({
  page,
}) => {
  await openCreate(page);
  await chooseType(page, 'Compliance');
  await page.getByLabel('Task type').click();
  const list = page.getByRole('listbox', { name: 'Task types' });
  await list.getByRole('button', { name: 'Edit Onboarding' }).click();
  const rename = page.getByRole('dialog');
  await rename.getByLabel('Name *').fill('Client Onboarding');
  await page.getByTestId('save-task-type').click();
  await expect(page.getByText(/Client Onboarding saved/)).toBeVisible();

  await page.getByLabel('Task type').click();
  await expect(list.getByRole('option', { name: 'Client Onboarding', exact: true })).toBeVisible();
  await list.getByRole('button', { name: 'Delete Compliance' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Compliance?' });
  await expect(confirm).toContainText('Tasks that already have it keep it.');
  await confirm.getByRole('button', { name: 'Delete Task Type' }).click();
  await expect(page.getByText('Compliance is deleted; tasks that have it keep it.')).toBeVisible();
  // It was the chosen type, so the field is empty again, and the type is gone from the list.
  await expect(page.getByLabel('Task type')).toHaveText('Select task type');
  await page.getByLabel('Task type').click();
  await expect(list.getByRole('option', { name: 'Compliance', exact: true })).toHaveCount(0);
});

test('T-D02: Completed (This Month) and Total Tasks list what they count, also from My Tasks', async ({
  page,
}) => {
  await page.goto(base);
  const table = page.getByTestId('task-table');
  await expect(table.getByTestId('task-link').first()).toBeVisible({ timeout: 60_000 });
  const count = async (id: string) =>
    Number(((await page.getByTestId(`kpi-${id}`).innerText()).match(/\d+/) ?? ['0'])[0]);
  const completed = await count('completed');
  expect(completed).toBeGreaterThan(0);
  await page.getByTestId('kpi-completed').click();
  await expect(page.getByTestId('kpi-completed')).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByTestId('task-link')).toHaveCount(Math.min(completed, 10));
  await page.getByTestId('kpi-all').click();
  await expect(page.getByTestId('kpi-all')).toHaveAttribute('aria-pressed', 'true');
  const total = await count('all');
  await expect(table.getByTestId('task-link')).toHaveCount(Math.min(total, 10));
});

test('T-C03: the series lists upcoming and skipped occurrences with the reason, one state at a time', async ({
  page,
}) => {
  await page.goto(`${base}?view=recurring`);
  await page.locator('a[href^="/tasks/recurring/0"]').first().click({ timeout: 60_000 });
  const occurrences = page.getByTestId('series-occurrences');
  const rows = page.getByTestId('occurrence-rows').getByRole('row');
  await expect(rows.first()).toContainText('Upcoming', { timeout: 60_000 });
  await rows.first().getByRole('button', { name: /^Skip/ }).click();
  await occurrences.getByLabel('Occurrence status').selectOption('SKIPPED');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Skipped');
  await expect(rows.first().getByTestId('occurrence-note')).toHaveText('Skipped.');
  await occurrences.getByLabel('Occurrence status').selectOption('SCHEDULED');
  await expect(rows.first()).toContainText('Upcoming');
});
