import { expect, test } from '@playwright/test';

// R56: the Tasks module in mock mode (playwright.mock.config.ts runs every module on mock data,
// as an Owner). Task 1 ("Prepare business plan draft") has a checklist with one required item.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tasks`;
const FIRST = '0199c0f0-0a10-7000-8000-000000000001';

test('Overview: five cards, seven views, the table and the side widgets', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(page.getByTestId('tasks-kpis').getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('tablist', { name: 'Task views' }).getByRole('tab')).toHaveCount(7);
  await expect(page.getByTestId('task-table').getByTestId('task-link').first()).toBeVisible();
  for (const id of [
    'rail-summary',
    'rail-upcoming',
    'card-templates',
    'card-quick',
    'card-calendar',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
});

test('A card filters the table, search narrows it, Reset clears both', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByTestId('task-table').getByTestId('task-link').first()).toBeVisible();
  await page.getByTestId('kpi-overdue').click();
  await expect(page.getByTestId('task-table').locator('[data-overdue]').first()).toBeVisible();
  const rows = page.getByTestId('task-table').getByTestId('task-link');
  const overdue = await rows.count();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => rows.count()).toBeGreaterThan(overdue);
  await page.getByLabel('Search tasks').fill('payroll');
  await expect(rows).toHaveCount(1);
});

test('Views: recurring, templates and completed', async ({ page }) => {
  await page.goto(base);
  const tab = (name: string) => page.getByRole('tab', { name });
  await tab('Recurring Tasks').click();
  await expect(page.getByTestId('series-rows').getByRole('row').first()).toBeVisible();
  await tab('Task Templates').click();
  await expect(page.getByTestId('template-rows').getByRole('row').first()).toBeVisible();
  await tab('Completed Tasks').click();
  await expect(page.getByTestId('task-table').getByText('Completed').first()).toBeVisible();
  await tab('By Client').click();
  await expect(page.getByTestId('grouped')).toBeVisible();
});

test('Create Task: checks the fields, saves, and opens the new task', async ({ page }) => {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
  await page.getByTestId('task-save').click();
  await expect(page.getByText('Enter the task name')).toBeVisible();
  await page.getByLabel('Task Name *').fill('Draft the Q4 estimate');
  await page.getByLabel('Task type').selectOption({ label: 'Tax Preparation' });
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Pull the ledger');
  await expect(page.getByTestId('form-summary')).not.toContainText('Client: —');
  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('task-title')).toHaveText('Draft the Q4 estimate');
  await expect(page.getByTestId('detail-checklist')).toContainText('Pull the ledger');
});

test('Detail: a required checklist item blocks Complete until it is done', async ({ page }) => {
  await page.goto(`${base}/${FIRST}`);
  await expect(page.getByTestId('checklist-progress')).toContainText('1 of 3 done');
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Finish the required checklist items first.')).toBeVisible();
  await page.getByLabel('Write executive summary').click();
  await expect(page.getByTestId('checklist-progress')).toContainText('2 of 3 done');
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Task completed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
});

test('Edit Task saves into the same task', async ({ page }) => {
  await page.goto(`${base}/${FIRST}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();
  await expect(page.getByLabel('Task Name *')).not.toHaveValue('');
  await page.getByLabel('Task Name *').fill('Prepare business plan draft v2');
  await page.getByTestId('task-save').click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${FIRST}$`));
  await expect(page.getByTestId('task-title')).toHaveText('Prepare business plan draft v2');
});

test('Bulk: select rows and change the priority', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  const boxes = page.getByTestId('task-table').getByRole('checkbox');
  await expect(boxes.nth(1)).toBeVisible();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toContainText(
    '2 tasks selected',
  );
  await page
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Priority' })
    .click();
  await page.getByRole('dialog').getByLabel('Priority').selectOption('LOW');
  await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
  await expect(page.getByText('2 updated.')).toBeVisible();
});

test('Recurring: previews the next five dates, saves, then skips one', async ({ page }) => {
  await page.goto(`${base}/recurring/new`);
  await expect(page.getByTestId('rec-dates').getByRole('listitem')).toHaveCount(5);
  await page.getByTestId('series-save').click();
  await expect(page.getByText('Enter the task name')).toBeVisible();
  await page.getByLabel('Task Name *').fill('Monthly books close');
  await page.getByLabel('Task Type *').selectOption({ label: 'Bookkeeping' });
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Assign To *').selectOption({ index: 1 });
  await page.getByTestId('series-save').click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('series-title')).toHaveText('Monthly books close');
  await page.getByTestId('occurrence-rows').getByRole('button', { name: /^Skip/ }).first().click();
  await expect(page.getByText('Occurrence skipped.')).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Series paused.')).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', '/new', `/${FIRST}`, `/${FIRST}/edit`, '/recurring/new', '/types']) {
    await page.goto(`${base}${path}`);
    await expect(
      page.locator('[data-testid^="task"], [data-testid^="recurring"]').first(),
    ).toBeVisible();
    await page.waitForTimeout(600);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'overview').toBeLessThanOrEqual(1);
  }
});
