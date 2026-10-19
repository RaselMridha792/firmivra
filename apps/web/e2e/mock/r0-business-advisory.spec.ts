import { expect, test } from '@playwright/test';

// R0: Business Advisory & Development in mock mode (every module on mock data, as an Owner): seven
// live advisory clients, five upcoming meetings, ten goals and the resource library.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/business-advisory`;

test('Overview: header, four KPIs, eight tabs, quick actions, clients, meetings, goals and resources', async ({
  page,
}) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Business Advisory & Development', level: 1 }),
  ).toBeVisible();
  const kpis = page.getByTestId('ba-kpis');
  await expect(kpis.getByRole('listitem')).toHaveCount(4);
  await expect(kpis).toContainText('Active Advisory Clients');
  await expect(kpis).toContainText('Growth Action Plans In Progress');
  await expect(
    page.getByRole('tablist', { name: 'Business advisory views' }).getByRole('tab'),
  ).toHaveCount(8);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const actions = page.getByTestId('quick-actions');
  await expect(actions.getByRole('link', { name: 'Create Business Plan' })).toHaveAttribute(
    'href',
    '/business-advisory/plans/new',
  );
  await expect(actions.getByRole('link', { name: 'Schedule Advisory Meeting' })).toBeVisible();
  await expect(actions.getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('recent-clients').getByTestId('client-link')).toHaveCount(5);
  await expect(page.getByTestId('recent-clients')).toContainText('Taylor Construction LLC');
  const meetings = page.getByTestId('meetings');
  await expect(meetings.getByRole('link', { name: /^Join the meeting/ })).toHaveCount(4);
  await expect(meetings.getByRole('link', { name: /^Open the meeting/ })).toHaveCount(1);
  await expect(page.getByTestId('goals').getByRole('progressbar')).toHaveCount(5);
  await expect(page.getByTestId('goals')).toContainText('Overdue');
  await expect(page.getByTestId('resources').getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('resources')).toContainText('Business Formation Checklist');
});

test('Row actions: open the advisory detail, and add a goal for that client', async ({ page }) => {
  await page.goto(base);
  const recent = page.getByTestId('recent-clients');
  await recent.getByRole('button', { name: 'Actions for Marcus Taylor' }).click();
  await expect(page.getByRole('menuitem', { name: 'Create Business Plan' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add Business Goal' }).click();
  const dialog = page.getByTestId('add-goal');
  await expect(dialog.getByLabel('Advisory client')).not.toHaveValue('');
  await dialog.getByLabel('Goal', { exact: true }).fill('Open a second yard');
  await dialog.getByLabel('Area').selectOption('EXPANSION');
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  await dialog.getByRole('textbox', { name: 'Milestone 1' }).fill('Sign the lease');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Goal' }).click();
  await expect(page.getByText('Goal added: Open a second yard')).toBeVisible();

  await recent.getByRole('button', { name: 'Actions for Marcus Taylor' }).click();
  await page.getByRole('menuitem', { name: 'Open Advisory Detail' }).click();
  await expect(page).toHaveURL(/\/business-advisory\/clients\/[0-9a-f-]{36}$/, {
    timeout: 60_000,
  });
});

test('Add Advisory Client: a firm client joins with a service focus; adding twice is refused', async ({
  page,
}) => {
  await page.goto(base);
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Add Advisory Client' })
    .click();
  const dialog = page.getByTestId('add-advisory-client');
  await dialog
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await dialog.getByLabel('Primary service focus').selectOption({ label: 'Business Planning' });
  await dialog.getByRole('checkbox', { name: 'Financial Analysis' }).click();
  await dialog.getByLabel('Business stage').selectOption('Growth');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Client' }).click();
  await expect(page).toHaveURL(/\/business-advisory\/clients\/[0-9a-f-]{36}$/, {
    timeout: 60_000,
  });

  await page.goBack();
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Add Advisory Client' })
    .click();
  await dialog
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await dialog.getByLabel('Primary service focus').selectOption({ label: 'Business Planning' });
  await page.getByRole('dialog').getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByRole('alert')).toContainText('in the advisory program already');
});

test('Advisory Clients: search, filter, archive and restore', async ({ page }) => {
  await page.goto(`${base}/clients`);
  const list = page.getByTestId('ba-clients');
  await expect(list.getByTestId('client-link')).toHaveCount(7);
  await list.getByLabel('Search clients').fill('logistics');
  await expect(list.getByTestId('client-link')).toHaveCount(1);
  await expect(list).toContainText('KM Logistics');
  await list.getByLabel('Search clients').fill('');
  await list.getByLabel('Status').selectOption('SCHEDULED');
  await expect(list.getByTestId('client-link')).toHaveCount(2);
  await list.getByLabel('Status').selectOption('');
  await list.getByRole('button', { name: 'Actions for Priya Shah' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('Priya Shah archived.')).toBeVisible();
  await expect(list.getByTestId('client-link')).toHaveCount(6);
  await list.getByRole('checkbox', { name: 'Show archived' }).click();
  await expect(list.getByTestId('client-link')).toHaveCount(8);
  await list.getByRole('button', { name: 'Actions for Priya Shah' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByText('Priya Shah restored.')).toBeVisible();
});

test('Business Plans: review, finalize, send, and the version history', async ({ page }) => {
  await page.goto(`${base}/plans`);
  const list = page.getByTestId('ba-plans');
  await expect(list.getByTestId('plan-link')).toHaveCount(6);
  // A draft without a strategy cannot be finalized.
  await list.getByRole('button', { name: 'Actions for 2026 Startup Launch Plan' }).click();
  await page.getByRole('menuitem', { name: 'Finalize Plan' }).click();
  await expect(page.getByText('The plan is not ready yet.')).toBeVisible();
  await expect(page.getByText(/Still needed: Add the strategy summary or an area/)).toBeVisible();
  // The plan in review finalizes, then goes to the client.
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Finalize Plan' }).click();
  await expect(page.getByText('Fleet Expansion Plan finalized.')).toBeVisible();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Send to Client' }).click();
  await page.getByTestId('send-plan').getByLabel('Send by').selectOption('EMAIL');
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Fleet Expansion Plan sent (email).')).toBeVisible();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Version History' }).click();
  await expect(page.getByTestId('plan-versions')).toContainText('Version 1');
  await expect(page.getByTestId('plan-versions')).toContainText('Email');
});

test('Goals & Milestones: filter, edit a goal and track its milestones', async ({ page }) => {
  await page.goto(`${base}/goals`);
  const list = page.getByTestId('ba-goals');
  await expect(list.getByTestId('goal-link')).toHaveCount(10);
  await list.getByLabel('Status').selectOption('AT_RISK');
  await expect(list.getByTestId('goal-link')).toHaveCount(1);
  await list.getByLabel('Status').selectOption('');
  await list.getByTestId('goal-link').filter({ hasText: 'Increase annual revenue by 25%' }).click();
  const form = page.getByTestId('edit-goal');
  await expect(form.getByTestId('milestones')).toContainText('1 of 3 done');
  await form.getByLabel('Status of Launch referral program').selectOption('COMPLETED');
  await expect(form.getByTestId('milestones')).toContainText('2 of 3 done');
  await form.getByLabel('New milestone').fill('Open the second office');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByTestId('milestones')).toContainText('Open the second office');
  await form.getByLabel('Progress (%)').fill('75');
  await form.getByRole('button', { name: 'Save Goal' }).click();
  await expect(page.getByText('Goal saved: Increase annual revenue by 25%')).toBeVisible();
  await expect(list).toContainText('75%');
});

test('Financial Analysis: summary, filters, and adding a period of figures', async ({ page }) => {
  await page.goto(`${base}/financial-analysis`);
  const tab = page.getByTestId('ba-financials');
  await expect(tab.getByTestId('financial-summary')).toContainText('Revenue');
  await expect(tab).toContainText('Stale');
  await tab.getByLabel('Client').selectOption({ label: 'Marcus Taylor' });
  await expect(tab.getByRole('row')).toHaveCount(3);
  await tab.getByRole('button', { name: 'Add Figures' }).click();
  const dialog = page.getByTestId('add-figures');
  await dialog.getByLabel('Advisory client').selectOption({ label: 'Sandra Lewis' });
  await dialog.getByLabel('Revenue ($)', { exact: true }).fill('210000');
  await dialog.getByLabel('Expenses ($)', { exact: true }).fill('180000');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Figures' }).click();
  await expect(page.getByText('Figures added for Sandra Lewis.')).toBeVisible();
});

test('Action Plans: move a recommendation, finish a task and add one', async ({ page }) => {
  await page.goto(`${base}/action-plans`);
  const recs = page.getByTestId('ba-recommendations');
  await expect(recs.getByRole('button', { name: /^Actions for / })).toHaveCount(8);
  await recs.getByRole('button', { name: 'Actions for Hire Operations Manager' }).click();
  await page.getByRole('menuitem', { name: 'Accept' }).click();
  await expect(page.getByText('Hire Operations Manager: accepted.')).toBeVisible();
  const tasks = page.getByTestId('ba-action-items');
  await tasks.getByRole('checkbox', { name: 'Overdue only' }).click();
  await expect(tasks.getByRole('button', { name: /^Actions for / })).toHaveCount(2);
  await tasks.getByRole('checkbox', { name: 'Overdue only' }).click();
  await tasks.getByRole('button', { name: 'Actions for Register the business name' }).click();
  await page.getByRole('menuitem', { name: 'Mark Done' }).click();
  await expect(page.getByText('Register the business name: done.')).toBeVisible();
  await tasks.getByRole('button', { name: 'Add Action Item' }).click();
  const dialog = page.getByTestId('add-action-item');
  await dialog.getByLabel('Advisory client').selectOption({ label: 'Kevin Martin' });
  await dialog.getByLabel('Action item').fill('Call the lender');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Action Item' }).click();
  await expect(page.getByText('Action item added: Call the lender')).toBeVisible();
  await expect(page.getByTestId('ba-milestones-note').getByRole('link')).toHaveAttribute(
    'href',
    '/business-advisory/goals',
  );
});

test('Resources: the library by category; only client resources are sent', async ({ page }) => {
  await page.goto(`${base}/resources`);
  const lib = page.getByTestId('ba-resources');
  await expect(lib.getByTestId('resource-group')).toHaveCount(10);
  await expect(lib.getByRole('button', { name: /^Send .* to a client$/ })).toHaveCount(9);
  await expect(lib).toContainText('Staff only');
  await lib.getByLabel('Audience').selectOption('staff');
  await expect(lib.getByTestId('resource-group')).toHaveCount(1);
  await lib.getByLabel('Audience').selectOption('');
  await lib.getByRole('button', { name: 'Send Brand Basics Guide to a client' }).click();
  await page
    .getByTestId('send-resource')
    .getByLabel('Advisory client')
    .selectOption({ label: 'Alicia Park' });
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Brand Basics Guide sent to Alicia Park.')).toBeVisible();
});

test('Reports: live counts by status, workload and trend, for one advisor too', async ({
  page,
}) => {
  await page.goto(`${base}/reports`);
  await expect(page.getByTestId('report-clients')).toContainText('In Progress');
  await expect(page.getByTestId('report-plans')).toContainText('sent to clients this year');
  await expect(page.getByTestId('report-workload')).toContainText('Sam Staff');
  await expect(page.getByTestId('report-trend').getByRole('row')).toHaveCount(4);
  await page.getByTestId('ba-reports').getByLabel('Advisor').selectOption({ label: 'Sam Staff' });
  await expect(page.getByTestId('report-workload').getByRole('row')).toHaveCount(2);
});
