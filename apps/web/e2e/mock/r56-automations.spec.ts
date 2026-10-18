import { expect, test } from '@playwright/test';

// R56: the Automations module in mock mode (playwright.mock.config.ts runs every module on mock
// data, as an Owner). 12 rules (10 active, one paused, one draft with no template chosen), 60 runs.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/automations`;

test('Overview: five cards, categories, the rules, how it works, templates and quick actions', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Automation', level: 1 })).toBeVisible();
  await expect(page.getByTestId('automation-kpis').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByTestId('categories')).toContainText('All Automations');
  await expect(page.getByTestId('rules-table').getByTestId('rule-link').first()).toBeVisible();
  for (const id of ['how', 'popular', 'quick', 'tip', 'recent-activity']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(
    page.getByTestId('popular').getByRole('button', { name: /^Use template/ }),
  ).toHaveCount(6);
});

test('Filters, categories and the on or off switch', async ({ page }) => {
  await page.goto(base);
  await page
    .getByTestId('categories')
    .getByRole('button', { name: /Compliance/ })
    .click();
  await expect(page.getByTestId('rules-table')).toContainText('Mark Overdue & Notify');
  await expect(page.getByTestId('rules-table')).not.toContainText('Document Upload Notification');
  await page
    .getByTestId('categories')
    .getByRole('button', { name: /All Automations/ })
    .click();
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('document upload');
  await expect(page.getByTestId('rules-table').getByTestId('rule-link')).toHaveCount(1);
  await page.getByRole('switch', { name: 'Document Upload Notification is on' }).click();
  await expect(
    page.getByRole('switch', { name: 'Document Upload Notification is off' }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('new lead');
  await page.getByRole('switch', { name: 'New Lead Follow-Up (draft) is off' }).click();
  await expect(
    page.getByText('This rule is not ready to turn on. Fix the checks first.'),
  ).toBeVisible();
});

test('Row menu: test, duplicate, archive', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Actions for Send Extension Reminder' }).click();
  await page.getByRole('menuitem', { name: 'Test' }).click();
  await expect(page.getByTestId('preview-panel')).toContainText('matching record');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Send Extension Reminder' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('Send Extension Reminder archived.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('mark overdue');
  await page.getByRole('button', { name: 'Actions for Mark Overdue & Notify' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByLabel('Rule Name *')).toHaveValue('Mark Overdue & Notify (Copy)');
});

test('Builder: validation, a full rule, the live review and activation', async ({ page }) => {
  await page.goto(`${base}/new`);
  await expect(page.getByTestId('builder-title')).toHaveText('Create Automation Rule');
  await page.getByTestId('save-activate').click();
  await expect(page.getByText('Enter the rule name')).toBeVisible();
  await page.getByLabel('Trigger Type *').selectOption({ label: 'Deadline Approaching' });
  await page.getByLabel('When *').selectOption('BEFORE');
  await page.getByLabel('Before *').fill('14');
  await page.getByRole('button', { name: 'Add Condition' }).click();
  await page.getByLabel('Condition 1 value').selectOption({ label: 'Business Client' });
  await page.getByRole('button', { name: 'Add Action' }).click();
  await page.getByLabel('Action 1', { exact: true }).selectOption('SEND_EMAIL');
  await expect(page.getByTestId('preview-panel')).toContainText('choose email template');
  await page.getByLabel('Action 1: Email Template *').selectOption({ index: 1 });
  await expect(page.getByTestId('preview-panel')).toContainText('All checks passed');
  await expect(page.getByTestId('trigger-hint')).toContainText('14 days before due date');
  await expect(page.getByTestId('affects')).toContainText('24');
  await page.getByRole('button', { name: /View Matching Clients/ }).click();
  await expect(page.getByTestId('matching').getByRole('listitem').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Rule Name *').fill('Business Reminder – 14 Days');
  await expect(page.getByTestId('rule-summary')).toContainText('Business Reminder – 14 Days');
  await page.getByTestId('save-activate').click();
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByTestId('rule-summary')).toContainText('Active');
});

test('Builder: an action with no template blocks activation', async ({ page }) => {
  await page.goto(`${base}/new`);
  await page.getByLabel('Trigger Type *').selectOption({ label: 'Deadline Approaching' });
  await page.getByRole('button', { name: 'Add Action' }).click();
  await page.getByLabel('Action 1', { exact: true }).selectOption('SEND_EMAIL');
  await page.getByLabel('Rule Name *').fill('Needs a template');
  await page.getByTestId('save-activate').click();
  await expect(
    page.getByText('This rule is not ready to turn on. Fix the checks first.'),
  ).toBeVisible();
});

test('Logs: counts, a failed run, its error and a re-run', async ({ page }) => {
  await page.goto(`${base}/logs`);
  await expect(page.getByTestId('log-kpis').getByRole('listitem')).toHaveCount(5);
  await page.getByLabel('Status', { exact: true }).selectOption('failed');
  await expect(page.getByTestId('logs-table')).toContainText('Failed');
  await page
    .getByTestId('logs-table')
    .getByRole('button', { name: /^View / })
    .first()
    .click();
  await expect(page.getByTestId('run-error')).toContainText('Email could not be delivered.');
  await page.getByTestId('rerun').click();
  await page.getByLabel('Why are you re-running it?').fill('Client fixed the address');
  await page.getByRole('dialog').getByRole('button', { name: 'Re-run' }).click();
  await expect(page.getByText('Run repeated.')).toBeVisible();
  await page.getByTestId('export-logs').click();
  await expect(page.getByText(/automation-logs\.csv: \d+ row/)).toBeVisible();
  await page.getByRole('button', { name: 'View Automation Settings' }).click();
  await page.getByLabel('Prevent duplicates (days)').fill('10');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('Templates: use one, export and import', async ({ page }) => {
  await page.goto(`${base}/templates`);
  await expect(page.getByTestId('template-table')).toContainText('Estimated Tax Payment Workflow');
  await page.getByRole('button', { name: 'Export Payroll Tax Filing Workflow' }).click();
  await expect(page.getByTestId('exported')).toContainText('firmivra.automation-template');
  const text = await page.getByTestId('exported').locator('pre').innerText();
  const file = JSON.parse(text);
  file.template.name = 'Imported copy';
  await page.getByRole('button', { name: 'Import Template' }).click();
  await page.getByLabel('Template file').fill(JSON.stringify(file));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Imported copy imported.')).toBeVisible();
  await page.getByRole('button', { name: 'Use template Imported copy' }).click();
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByLabel('Rule Name *')).toHaveValue('Imported copy');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', '/new', '/logs', '/templates']) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'overview').toBeLessThanOrEqual(1);
  }
});
