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

const startupPlan = `${base}/plans/0199c0f1-a400-7000-8000-000000000002/edit`;

test('Plan wizard: a new plan starts from the client record and moves to step 2', async ({
  page,
}) => {
  await page.goto(`${base}/plans/new?advisoryClientId=0199c0f1-a200-7000-8000-000000000002`);
  await expect(page.getByRole('heading', { name: 'Create Business Plan', level: 1 })).toBeVisible();
  await expect(page.getByTestId('client-card')).toContainText('SL Beauty Studio');
  await expect(page.getByLabel('Business Name')).toHaveValue('SL Beauty Studio');
  await expect(page.getByTestId('quick-tips')).toBeVisible();
  await expect(page.getByTestId('whats-next').getByRole('listitem')).toHaveCount(5);
  // Next needs the plan name; a draft could save without the rest.
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('Fill in the required fields to continue')).toBeVisible();
  await page.getByLabel('Plan Name').fill('Salon Growth Plan');
  await page.getByLabel('How did you hear about us?').selectOption('Existing Client');
  await page.getByLabel('Notes (optional)').fill('Wants online booking first.');
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}\/edit\/assessment$/, { timeout: 60_000 });
  await expect(page.getByTestId('step-financials')).toContainText('Bookkeeping');
});

test('Plan wizard: the review says what is still needed, then the plan finalizes', async ({
  page,
}) => {
  await page.goto(`${startupPlan}/review`);
  await expect(page.getByTestId('still-needed')).toContainText(
    'Add the strategy summary or an area (stage 3)',
  );
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  // The Goals & Strategy summary's Edit link (profile, assessment, strategy, action plan).
  await page.getByRole('link', { name: 'Edit', exact: true }).nth(2).click();
  await expect(page.getByTestId('step-areas')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-areas').getByRole('checkbox', { name: 'Marketing / Sales' }).click();
  await page.getByLabel('Marketing / Sales objective').fill('Book 40 appointments a week');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('step-milestones')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('step-readiness')).toContainText('Ready to finalize', {
    timeout: 60_000,
  });
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('2026 Startup Launch Plan finalized.')).toBeVisible();
  await expect(page.getByTestId('step-delivery')).toContainText('Version 1');
});

test('Plan wizard: leaving with unsaved changes asks first', async ({ page }) => {
  await page.goto(`${startupPlan}/assessment`);
  await page.getByLabel('Timing').fill('Within a year');
  await page.getByRole('button', { name: 'Back to Business Advisory & Development' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(page.getByLabel('Timing')).toHaveValue('Within a year');
  // Save Draft in the prompt saves the step, then leaves.
  await page.getByRole('button', { name: 'Back to Business Advisory & Development' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save Draft' }).click();
  await expect(page).toHaveURL(/\/business-advisory$/, { timeout: 60_000 });
});

const marcus = `${base}/clients/0199c0f1-a200-7000-8000-000000000001`;

test('Client detail: header, plan status, KPIs, the nine cards and eleven tabs', async ({
  page,
}) => {
  await page.goto(marcus);
  await expect(
    page.getByRole('heading', { name: 'Client Advisory Detail', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('client-card')).toContainText('Taylor Construction LLC');
  await expect(page.getByTestId('client-card')).toContainText('Active Advisory Client');
  await expect(page.getByTestId('plan-status')).toContainText('2026 Business Growth Plan');
  await expect(
    page.getByRole('tablist', { name: 'Client advisory views' }).getByRole('tab'),
  ).toHaveCount(11);
  await expect(page.getByTestId('client-kpis').getByRole('listitem')).toHaveCount(6);
  await expect(page.getByTestId('kpi-revenue')).toContainText('$1,250,000');
  await expect(page.getByTestId('kpi-goals')).toContainText('on track');
  for (const id of [
    'business',
    'goals',
    'meeting',
    'financials',
    'recommendations',
    'notes',
    'tasks',
    'documents',
  ])
    await expect(page.getByTestId(`card-${id}`)).toBeVisible();
  await expect(
    page.getByTestId('card-meeting').getByRole('link', { name: 'Join Meeting' }),
  ).toBeVisible();
  await expect(page.getByTestId('snapshot')).toContainText('16.8%');
});

test('Client detail: the health score explains itself; Edit Client saves the record and services', async ({
  page,
}) => {
  await page.goto(marcus);
  await page.getByTestId('kpi-health').getByRole('button', { name: 'How it works' }).click();
  const health = page.getByTestId('health-dialog');
  await expect(health).toContainText('Revenue trend');
  await expect(health).toContainText('Goal progress');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
  await page.getByRole('button', { name: 'Edit Client' }).click();
  const dialog = page.getByTestId('edit-client');
  await dialog.getByLabel('Add a service').selectOption({ label: 'Business Planning' });
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByTestId('client-services').getByRole('listitem')).toHaveCount(4);
  await dialog.getByLabel('Status', { exact: true }).selectOption('NEEDS_REVIEW');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Client' }).click();
  await expect(page.getByTestId('client-card')).toContainText('Active Advisory Client');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Client tabs: the business plan, with its versions and every plan', async ({ page }) => {
  await page.goto(`${marcus}/plan`);
  await expect(page.getByTestId('tab-current-plan')).toContainText('2026 Business Growth Plan');
  await expect(page.getByTestId('tab-current-plan')).toContainText('Ready to finalize');
  await expect(page.getByTestId('tab-versions')).toContainText('Version 1');
  await expect(page.getByTestId('tab-plans').getByRole('row')).toHaveCount(2);
  await expect(
    page.getByTestId('tab-current-plan').getByRole('link', { name: 'Continue Editing' }),
  ).toHaveAttribute('href', /\/edit\/review$/);
});

test('Client tabs: goals and tasks are the client own', async ({ page }) => {
  await page.goto(`${marcus}/goals`);
  const goals = page.getByTestId('ba-goals');
  await expect(goals.getByTestId('goal-link')).toHaveCount(5);
  await expect(goals.getByLabel('Client', { exact: true })).toHaveCount(0);
  await goals.getByRole('button', { name: 'Add Business Goal' }).click();
  await expect(page.getByTestId('add-goal').getByLabel('Advisory client')).not.toHaveValue('');
  await page
    .getByTestId('add-goal')
    .getByLabel('Goal', { exact: true })
    .fill('Win a city contract');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Goal' }).click();
  await expect(goals.getByTestId('goal-link')).toHaveCount(6);
  await page.goto(`${marcus}/tasks`);
  const tasks = page.getByTestId('ba-action-items');
  await expect(tasks.getByRole('button', { name: /^Actions for / })).toHaveCount(5);
  await expect(tasks).not.toContainText('Kevin Martin');
});

test('Client tabs: the notes composer and list, and the activity log', async ({ page }) => {
  await page.goto(`${marcus}/notes`);
  // Notes belong to the client record (api.clientNotes); its mock holds none of the advisory
  // mock's clients, so the list is empty here and a save is that module's own test.
  await expect(page.getByTestId('tab-notes')).toContainText('No notes yet.');
  const save = page.getByRole('button', { name: 'Save Note' });
  await expect(save).toBeDisabled();
  await page
    .getByTestId('tab-note-new')
    .getByLabel('Note')
    .fill('Talked through the SBA timeline.');
  await expect(save).toBeEnabled();
  await page.goto(`${marcus}/activity`);
  const log = page.getByTestId('tab-activity');
  await expect(log).toContainText('Plan finalized');
  await expect(log).toContainText('Added to the advisory program');
});
