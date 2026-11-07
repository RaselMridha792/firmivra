import { expect, test } from '@playwright/test';

// R56: the Compliance & Deadlines module in mock mode (playwright.mock.config.ts runs every module
// on mock data, as an Owner). Deadline 1 ("Q3 Estimated Tax Payment") is overdue and open.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/compliance`;
const FIRST = '0199c0f0-2d00-7000-8000-000000000001';

test('Overview: six cards, seven views, the table and the side widgets', async ({ page }) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Compliance & Deadlines', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('compliance-kpis').getByRole('button')).toHaveCount(6);
  await expect(
    page.getByRole('tablist', { name: 'Compliance views' }).getByRole('tab'),
  ).toHaveCount(7);
  await expect(
    page.getByTestId('deadline-table').getByTestId('deadline-link').first(),
  ).toBeVisible();
  for (const id of [
    'filters',
    'card-calendar',
    'card-types',
    'card-risk',
    'card-quick',
    'card-resources',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('mini-month').getByRole('button').first()).toBeVisible();
});

test('Filters and views: overdue status, By Client, By Type, Calendars, Recurring', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByTestId('kpi-overdue').click();
  await expect(page.getByTestId('deadline-table').locator('[data-overdue]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  const tab = (name: string) => page.getByRole('tab', { name });
  await tab('By Client').click();
  await expect(page.getByTestId('by-client')).toContainText('Taylor Construction LLC');
  await tab('By Type').click();
  await expect(page.getByTestId('by-type')).toBeVisible();
  await tab('Government Calendars').click();
  await expect(page.getByTestId('calendars-view')).toContainText('IRS Tax Calendar');
  await tab('Recurring').click();
  await expect(page.getByTestId('recurring-rows')).toContainText('Monthly Payroll Tax Deposit');
  await tab('Completed').click();
  await expect(page.getByTestId('deadline-table').getByText('Completed').first()).toBeVisible();
});

test('Tax Calendar and Settings open and save', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Tax Calendar' }).click();
  await expect(page.getByTestId('tax-calendar')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-form')).toBeVisible();
  await page.getByLabel('Due Soon (days)').fill('10');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('Add Deadline: checks the fields, saves, and opens the new deadline', async ({ page }) => {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Add Deadline' })).toBeVisible();
  await page.getByTestId('deadline-save').click();
  await expect(page.getByText('Enter the deadline name')).toBeVisible();
  await page.getByLabel('Deadline Name *').fill('Q4 Sales Tax Return');
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.locator('#df-due').fill('2027-01-20');
  await expect(page.getByTestId('deadline-summary')).toContainText('Q4 Sales Tax Return');
  await page.getByTestId('deadline-save').click();
  await expect(page).toHaveURL(/\/compliance\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('deadline-title')).toHaveText('Q4 Sales Tax Return');
});

test('Changing a statutory date needs a reason', async ({ page }) => {
  await page.goto(`${base}/${FIRST}/edit`);
  await expect(page.getByLabel('Deadline Name *')).not.toHaveValue('');
  // Any date but the stored one (the mock's is 9 days ago).
  const moved = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  await page.locator('#df-due').fill(moved);
  await page.getByTestId('deadline-save').click();
  await expect(page.getByText('Give a reason for changing the statutory date')).toBeVisible();
  await page.getByLabel('Reason for changing the statutory date *').fill('IRS disaster relief');
  await page.getByTestId('deadline-save').click();
  await expect(page).toHaveURL(new RegExp(`/compliance/${FIRST}$`));
  await expect(page.getByTestId('detail-dates')).toContainText('IRS disaster relief');
});

test('Detail: complete a deadline, then reopen it', async ({ page }) => {
  await page.goto(`${base}/${FIRST}`);
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Deadline completed.')).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Deadline reopened.')).toBeVisible();
});

test('Create Task makes one task, then View Task opens it (CD-F01)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/${FIRST}`);
  const tasks = page.getByTestId('detail-tasks');
  await tasks.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByText('Task created.')).toBeVisible();
  await expect(tasks.getByRole('button', { name: 'Create Task' })).toHaveCount(0);
  await expect(tasks.getByRole('link', { name: 'View Task' })).toHaveAttribute(
    'href',
    /^\/tasks\/[0-9a-f-]{36}$/,
  );
  await expect(tasks.getByRole('listitem')).toHaveCount(1);
  await tasks.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('create-task.png') });
});

test('Bulk: select rows and change the status', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'All Deadlines' }).click();
  const boxes = page.getByTestId('deadline-table').getByRole('checkbox');
  await expect(boxes.nth(1)).toBeVisible();
  await boxes.nth(1).click();
  await boxes.nth(2).click();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 deadlines selected');
  await bar.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/\d+ updated/)).toBeVisible();
});

test('Recurring setup: live preview, validation, save', async ({ page }) => {
  await page.goto(`${base}/recurring/new`);
  await expect(page.getByTestId('preview-dates').getByRole('listitem')).toHaveCount(5);
  await page.getByTestId('recurring-save').click();
  await expect(page.getByText('Enter the deadline name')).toBeVisible();
  await page.getByLabel('Deadline Name *').fill('Quarterly Sales Tax');
  await page.getByTestId('recurring-save').click();
  await expect(page.getByTestId('manage-rows')).toContainText('Quarterly Sales Tax');
});

test('Calendars: import a draft, verify, publish; rules and logs', async ({ page }) => {
  await page.goto(`${base}/recurring/new?tab=import`);
  await page.getByLabel('Authority *').fill('Florida Department of State');
  await page.getByLabel('Calendar name *').fill('Florida Annual Report 2027');
  await page.getByLabel('Official source URL *').fill('https://dos.fl.gov/sunbiz/');
  await page.getByLabel('Record 1 name').fill('Annual Report');
  await page.getByLabel('Due date').fill('2027-05-01');
  await page.getByRole('button', { name: 'Preview Import' }).click();
  await expect(page.getByTestId('diff')).toContainText('1 added');
  await page.getByTestId('import-save').click();
  await expect(page.getByTestId('calendar-library')).toContainText('Florida Annual Report 2027');
  const actions = page.getByRole('button', { name: 'Actions for Florida Annual Report 2027' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Verify' }).click();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Publish' }).click();
  await expect(page.getByText('Florida Annual Report 2027 published.')).toBeVisible();
  await page.getByRole('tab', { name: 'Applicability Rules' }).click();
  await expect(page.getByTestId('rules-tab')).toContainText(
    'Partnership and multi-member LLC return',
  );
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.getByTestId('logs-tab')).toContainText('Published');
});

test('Recurring: Save Changes saves an edit of the description alone (CD-F10)', async ({
  page,
}) => {
  await page.goto(`${base}/recurring/new?edit=0199c0f0-3e00-7000-8000-000000000001`);
  const description = page.getByLabel('Description');
  await expect(page.getByLabel('Deadline Name')).not.toHaveValue('');
  await description.fill('Fake: the payroll deposit for the month.');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(/tab=manage&saved=/);
});

test('Lists keep their place: a client at risk, Back, and Cancel from Add Deadline (CD-F02, F03, F05)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  // CD-F02: the list says which date it goes by.
  await expect(page.getByTestId('date-basis')).toContainText('effective due date');
  // CD-F03: View on a client at risk opens that client's deadlines, with the reason.
  const risky = page.getByTestId('card-risk').getByRole('link').first();
  await risky.click();
  await expect(page).toHaveURL(/tab=all&range=ALL&client=[0-9a-f-]{36}&risk=/);
  await expect(page.getByTestId('risk-banner')).toContainText('is at risk:');
  await page.screenshot({ path: test.info().outputPath('at-risk.png') });
  await page.goBack();
  await expect(page).toHaveURL(/\/compliance$/);
  // CD-F05: All Deadlines, All Dates and a type, then Add Deadline and Cancel: the same list.
  await page.getByRole('tab', { name: 'All Deadlines' }).click();
  await expect(page).toHaveURL(/tab=all/);
  await page.getByLabel('Date Range').selectOption('ALL');
  await page.getByLabel('Deadline Type').first().selectOption({ index: 1 });
  await expect(page).toHaveURL(/tab=all&type=/);
  const list = page.url();
  await page.getByRole('link', { name: 'Add Deadline' }).first().click();
  await expect(page).toHaveURL(/\/compliance\/new\?from=/);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(list);
  await expect(page.getByRole('tab', { name: 'All Deadlines' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Date Range')).toHaveValue('ALL');
});

test('Recurring workspace: the tab follows the address, an import draft survives a tab, a 0 interval claims nothing (CD-F09, F11, F12)', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('tablist', { name: 'Setup tabs' }).getByRole('tab', { name });
  // CD-F09: Logs stays after a reload; Back returns to Manage, with the address.
  await page.goto(`${base}/recurring/new?tab=manage`);
  await tab('Logs').click();
  await expect(page).toHaveURL(/tab=logs/);
  await page.reload();
  await expect(tab('Logs')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/tab=manage/);
  await expect(tab('Manage Existing Recurring')).toHaveAttribute('aria-selected', 'true');
  // CD-F12: an import draft is still there after another tab.
  await tab('Import Government Calendar').click();
  await page.getByLabel('Calendar name *').fill('Fake 2027 calendar');
  await tab('Logs').click();
  await tab('Import Government Calendar').click();
  await expect(page.getByLabel('Calendar name *')).toHaveValue('Fake 2027 calendar');
  // CD-F11: a custom interval of 0 claims no frequency.
  await tab('Setup Recurring Deadline').click();
  await page.locator('#rs-freq').selectOption('CUSTOM');
  await page.getByLabel('Every (months)').fill('0');
  await expect(page.getByTestId('setup-summary')).toContainText('Not set yet');
  await expect(page.getByTestId('setup-summary')).not.toContainText('Every 1 months');
});

test('A completed deadline opens read-only with Reopen; years and periods go wider (CD-F07, F08)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/${FIRST}`);
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Deadline completed.')).toBeVisible();
  // In mock mode the change lives in the page: Edit by its link, not a reload.
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByTestId('closed-banner')).toContainText('Completed');
  await expect(page.getByTestId('deadline-save')).toBeDisabled();
  await expect(page.getByLabel('Deadline Name').first()).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('completed-read-only.png') });
  await page.getByTestId('closed-banner').getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByTestId('closed-banner')).toHaveCount(0);
  await expect(page.getByTestId('deadline-save')).toBeEnabled();
  // CD-F08: a prior year, a specific month and a custom period.
  await expect(page.locator('#df-year option[value="2015"]')).toHaveCount(1);
  await expect(page.locator('#df-period option[value="Month of March"]')).toHaveCount(1);
  await page.locator('#df-period').selectOption('__custom__');
  await page.getByLabel('Custom period').fill('FY Jul 2025 – Jun 2026');
  await expect(page.getByLabel('Custom period')).toHaveValue('FY Jul 2025 – Jun 2026');
});

test('Help icons explain each area, and the setup tab follows the open tab (CD-F17)', async ({
  page,
}) => {
  await page.goto(base);
  const about = (topic: string) => page.getByRole('button', { name: `About ${topic}` });
  await about('Compliance overview').click();
  await expect(page.getByTestId('help-tip')).toContainText('Deadlines that are still to do');
  await page.keyboard.press('Escape');
  await expect(about('Filters')).toBeVisible();
  await page.goto(`${base}/recurring/new?tab=logs`);
  await expect(page.getByTestId('tab-help')).toContainText('Logs');
  await expect(about('Logs')).toBeVisible();
  await page
    .getByRole('tablist', { name: 'Setup tabs' })
    .getByRole('tab', { name: 'Applicability Rules' })
    .click();
  await expect(about('Applicability rules')).toBeVisible();
  await page.goto(`${base}/new`);
  await expect(about('A deadline')).toBeVisible();
});

test('Search and From/To on the deadline list; the library and Manage filter too (CD-F04, F13)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The mock's days are UTC days, like these.
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const filters = page.getByTestId('filters');
  const table = page.getByTestId('deadline-table');
  await page.goto(`${base}?tab=all`);
  // CD-F04: a search by name, client, agency or form, kept in the address.
  await filters.getByLabel('Search').fill('1065');
  await expect(page).toHaveURL(/q=1065/);
  await expect(table).toContainText('Form 1065 Partnership Return');
  await expect(table).not.toContainText('Annual Registration');
  await filters.getByLabel('Search').fill('');
  await expect(page).not.toHaveURL(/q=/);
  // A custom From and To in place of a named range.
  await filters.getByLabel('Date Range').selectOption('CUSTOM');
  await expect(page).toHaveURL(/range=CUSTOM/);
  await filters.getByLabel('From', { exact: true }).fill(day(5));
  await expect(page).toHaveURL(/start=/);
  await filters.getByLabel('To', { exact: true }).fill(day(13));
  await expect(page).toHaveURL(/end=/);
  await expect(table).toContainText('Monthly Bookkeeping Close');
  await expect(table).toContainText('Form 1120-S S Corporation Return');
  await expect(table).not.toContainText('Form 1065 Partnership Return');
  await expect(table).not.toContainText('Form 2553 S Election');
  await page.screenshot({ path: test.info().outputPath('custom-dates.png') });
  // An end before the start says so; Reset clears the dates and the search.
  await filters.getByLabel('To', { exact: true }).fill(day(2));
  await expect(filters.getByText('The end date is before the start date')).toBeVisible();
  await filters.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('custom-dates')).toBeHidden();
  await expect(page).not.toHaveURL(/start=|end=|range=CUSTOM/);
  // A client typed in full (the browser suggests the names), and More filters.
  await filters.getByLabel('Client', { exact: true }).fill('Jamie Sample');
  await expect(page).toHaveURL(/client=/);
  await filters.getByRole('button', { name: 'More filters' }).click();
  await filters.getByLabel('Priority').selectOption('HIGH');
  await expect(page).toHaveURL(/priority=HIGH/);
  await expect(table).toContainText('Q3 Estimated Tax Payment');
  await expect(table).not.toContainText('Q4 Estimated Tax Payment');
  await expect(table).not.toContainText('Annual Registration');
  // Combined with Unassigned there is none: the list says so.
  await filters.getByLabel('Assigned To').fill('Unassigned');
  await expect(page).toHaveURL(/assignee=none/);
  await expect(table).toContainText('No deadlines');
  await filters.getByRole('button', { name: 'Reset' }).click();
  await expect(page).not.toHaveURL(/client=|priority=|assignee=/);
  await expect(filters.getByLabel('Client', { exact: true })).toHaveValue('');

  // CD-F13: the library by name or authority, state and year.
  await page.goto(`${base}/recurring/new?tab=library`);
  const library = page.getByTestId('calendar-library');
  await library.getByLabel('Search').fill('north carolina');
  await expect(library).toContainText('North Carolina Annual Report');
  await expect(library).not.toContainText('IRS Employer Calendar');
  await library.getByLabel('Search').fill('');
  await library.getByLabel('State').selectOption('GA');
  await expect(library).toContainText('Georgia Annual Registration');
  await expect(library).not.toContainText('IRS Employer Calendar');
  await page.screenshot({ path: test.info().outputPath('library.png') });
  await library.getByLabel('State').selectOption('');
  await library.getByLabel('Year').selectOption(String(new Date().getFullYear() - 1));
  await expect(library).toContainText(`IRS Tax Calendar ${new Date().getFullYear() - 1}`);
  await expect(library).not.toContainText('IRS Employer Calendar');

  // CD-F13: Manage by status, kind (definitions or templates) and search.
  await page
    .getByRole('tablist', { name: 'Setup tabs' })
    .getByRole('tab', { name: 'Manage Existing Recurring' })
    .click();
  const manage = page.getByTestId('manage-rows');
  await manage.getByLabel('Status').selectOption('PAUSED');
  await expect(manage).toContainText('Georgia Annual Registration');
  await expect(manage).not.toContainText('Monthly Payroll Tax Deposit');
  await manage.getByLabel('Status').selectOption('');
  await manage.getByLabel('Kind').selectOption('templates');
  await expect(manage).toContainText('Monthly Sales Tax Return');
  await expect(manage).not.toContainText('Quarterly Payroll Return');
  await manage.getByLabel('Kind').selectOption('');
  await manage.getByLabel('Search').fill('941');
  await expect(manage).toContainText('Quarterly Payroll Return (Form 941)');
  await expect(manage).not.toContainText('Georgia Annual Registration');
  await page.screenshot({ path: test.info().outputPath('manage.png') });

  // CD-F13: a rule's states and excluded client statuses are chosen, never typed.
  await page
    .getByRole('tablist', { name: 'Setup tabs' })
    .getByRole('tab', { name: 'Applicability Rules' })
    .click();
  await page.getByRole('button', { name: 'New Rule' }).click();
  const form = page.getByTestId('rule-form');
  await form.getByLabel('Rule name').fill('Georgia payroll, not on hold');
  await form.getByLabel('Applies to a').selectOption('RECURRENCE');
  await form
    .getByLabel('Recurring deadline')
    .selectOption({ label: 'Monthly Payroll Tax Deposit' });
  await page.getByTestId('rule-states').getByLabel('GA', { exact: true }).check();
  await page.getByTestId('rule-exclude').getByLabel('On Hold').check();
  await expect(page.getByTestId('rule-states')).toContainText('1 chosen');
  await page.screenshot({ path: test.info().outputPath('rule-dialog.png') });
  await page.getByRole('button', { name: 'Save Rule' }).click();
  await expect(page.getByTestId('rules-tab')).toContainText('excluding On Hold');
});

test('Logs: search by record, dates before and after, the rule, and links to the record and the Audit Log (CD-F15, F16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const SECOND = '0199c0f0-2d00-7000-8000-000000000002';
  await page.goto(`${base}/recurring/new?tab=logs`);
  const logs = page.getByTestId('logs-tab');
  // CD-F16: a Generate names its rule and version; Owners and Admins open the Audit Log (CD-F15).
  await expect(logs).toContainText('Rule “Partnership and multi-member LLC return” (version 1)');
  await expect(page.getByTestId('logs-audit-link')).toHaveAttribute(
    'href',
    '/audit-log?action=compliance.',
  );
  // A record's name, kept in the address; the override shows its dates before and after.
  await logs.getByLabel('Search').fill('Form 941');
  await expect(page).toHaveURL(/logq=Form/);
  await expect(logs.getByTestId('log-record')).toHaveText('Form 941 Quarterly Payroll Return');
  await expect(logs).toContainText('Due date');
  await page.screenshot({ path: test.info().outputPath('logs.png') });
  await logs.getByLabel('Event').selectOption('GENERATE');
  await expect(page).toHaveURL(/event=GENERATE/);
  await expect(logs).toContainText('Nothing matches these filters.');
  await logs.getByLabel('Event').selectOption('');
  await expect(page).not.toHaveURL(/event=/);
  // The record opens, and Back returns to the same filtered log.
  await logs.getByTestId('log-record').click();
  await expect(page).toHaveURL(new RegExp(`/compliance/${SECOND}`));
  await expect(page.getByTestId('back-to-origin')).toContainText('Recurring Deadline Setup');
  await expect(page.getByRole('link', { name: 'Back to Compliance & Deadlines' })).toHaveCount(0);
  // CD-F15: the deadline opens its own activity and, for Owners and Admins, its audit history.
  await expect(page.getByTestId('deadline-audit')).toHaveAttribute(
    'href',
    `/audit-log?entityType=compliance_deadline&entityId=${SECOND}`,
  );
  await page.screenshot({ path: test.info().outputPath('deadline-links.png') });
  await page.goBack();
  await expect(page).toHaveURL(/tab=logs&logq=Form/);
  await expect(logs.getByLabel('Search')).toHaveValue('Form 941');
  await page.goto(`${base}/${SECOND}`);
  await page.getByTestId('deadline-activity').click();
  await expect(page).toHaveURL(new RegExp(`tab=logs&logq=${SECOND}`));
  await expect(logs.getByTestId('log-record')).toHaveText('Form 941 Quarterly Payroll Return');
  // The Audit Log opens filtered to what the link names.
  await page.goto(`${base}/${SECOND}`);
  await page.getByTestId('deadline-audit').click();
  await expect(page).toHaveURL(/\/audit-log\?entityType=compliance_deadline/);
  await expect(page.getByLabel('Record type')).toHaveValue('compliance_deadline');
  await expect(page.getByLabel('Record id')).toHaveValue(SECOND);
  await page.goto(`http://app.localhost:${port}/audit-log?action=compliance.`);
  await expect(page.getByLabel('Action', { exact: true })).toHaveValue('compliance.');
  await page.goto(`http://app.localhost:${port}/audit-log?entityType=Not%20Valid`);
  await expect(page.getByLabel('Record type')).toHaveValue('');
});

test("Attachments upload as the client's documents, join the deadline, and download (CD-F06)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/${FIRST}/edit`);
  const attach = page.getByTestId('attachments');
  await expect(attach.getByLabel('File it under')).toBeVisible();
  await expect(page.getByTestId('sec-attachments')).not.toContainText('not connected');
  const uploads = page.getByTestId('attachment-uploads');
  // A type the Documents module does not take is refused before anything is sent.
  await attach.getByLabel('Attach files').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic'),
  });
  await expect(uploads).toContainText('notes.txt');
  await expect(uploads).toContainText('Upload a ');
  // A PDF is saved to the client's documents and added under Related Items.
  await attach.getByLabel('Attach files').setInputFiles({
    name: 'engagement-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(uploads).toContainText('Saved to the client’s documents');
  await expect(page.getByTestId('sec-related')).toContainText('engagement-letter.pdf');
  await page.screenshot({ path: test.info().outputPath('attachments.png') });
  await page.getByTestId('deadline-save').click();
  await expect(page).toHaveURL(new RegExp(`/compliance/${FIRST}$`));
  const docs = page.getByTestId('detail-documents');
  await expect(docs).toContainText('engagement-letter.pdf');
  // A new file is scanned first (it says so until then); once clean it downloads.
  const button = docs
    .getByRole('listitem')
    .filter({ hasText: 'engagement-letter.pdf' })
    .getByTestId('document-download');
  await expect(async () => {
    const download = page.waitForEvent('download', { timeout: 3_000 });
    await button.click();
    expect((await download).suggestedFilename()).toBe('engagement-letter.pdf');
  }).toPass({ timeout: 30_000 });
});

test('A hand-entered government date needs verification, a reopened deadline keeps why it was set aside, At Risk says its rule, and Settings says where the rest is set (CD-Y03, Y07, Y09, Y10)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // CD-Y10: the overview's At Risk card explains its formula.
  await page.goto(base);
  await page.getByRole('button', { name: 'About At Risk clients' }).click();
  await expect(page.getByTestId('help-tip')).toContainText('due today is not overdue');
  await page.keyboard.press('Escape');
  // CD-Y03: Settings says where the defaults it does not hold are set.
  await page.getByRole('button', { name: 'Settings' }).click();
  const elsewhere = page.getByTestId('settings-elsewhere');
  await expect(elsewhere.getByRole('link', { name: 'Settings › Preferences' })).toHaveAttribute(
    'href',
    '/settings/preferences',
  );
  await expect(elsewhere.getByRole('link', { name: 'Applicability Rules' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('settings-elsewhere.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  // CD-Y07: no calendar behind a Government date: it says so.
  await page.goto(`${base}/${FIRST}`);
  await expect(page.getByTestId('source-note')).toContainText('Needs Verification');
  // CD-Y09: set aside with a reason, then reopened: the reason stays in view.
  await page.getByRole('button', { name: 'Not Applicable' }).click();
  await page.getByRole('dialog').getByLabel('Why does this not apply?').fill('Client dissolved');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Marked not applicable.')).toBeVisible();
  await expect(page.getByTestId('detail-dates')).toContainText('Not applicable because');
  await page.getByRole('button', { name: 'Reopen' }).first().click();
  await expect(page.getByText('Deadline reopened.')).toBeVisible();
  const dates = page.getByTestId('detail-dates');
  await expect(dates).toContainText('Earlier not applicable because');
  await expect(dates).toContainText('Client dissolved');
  await page.screenshot({ path: test.info().outputPath('reopened.png') });
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', '/new', `/${FIRST}`, `/${FIRST}/edit`, '/recurring/new']) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'overview').toBeLessThanOrEqual(1);
  }
});
