import { expect, test } from '@playwright/test';

// R55, Octavia's Automations review of Oct 28: Manage Rules shows Applies To at every width
// (AU-F01), Logs has activity tabs (AU-F02), the builder reads Trigger Event (AU-F03) and sets a
// Rule Owner (AU-F28). Mock mode, as the Owner; one 1440 px screenshot per screen.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/automations`;
const shots = 'e2e/mock/r55-screenshots/automations';

test('Manage Rules shows each rule’s Applies To at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  const table = page.getByRole('table').first();
  await expect(table.getByRole('columnheader', { name: 'Applies To' })).toBeVisible();
  await page.screenshot({ path: `${shots}/manage-rules.png` });
});

test('the builder reads Trigger Event and takes a Rule Owner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new`);
  await expect(page.getByLabel('Trigger Event *')).toBeVisible();
  const owner = page.getByLabel('Rule Owner');
  await expect(owner).toBeEnabled();
  await expect(owner.locator('option').first()).toHaveText('You (the rule’s creator)');
  await owner.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/builder-owner.png` });
});

test('the trigger says when it runs, with an example in the firm’s time zone (AU-F04 to F07)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new`);
  await page.getByLabel('Trigger Event *').selectOption({ label: 'Deadline Approaching' });
  await page.getByLabel('When *').selectOption('BEFORE');
  await expect(page.getByLabel('When *').locator('option:checked')).toHaveText(
    'Before the due date',
  );
  await page.getByLabel('Before *').fill('14');
  await expect(page.getByTestId('trigger-sentence')).toContainText(
    'Runs 14 days before the due date. For example, if the due date is',
  );
  await expect(page.getByTestId('trigger-timezone')).toHaveText(
    "Times use your firm's time zone (America/New_York).",
  );
  await page.getByLabel('Before *').fill('-2');
  await expect(page.getByText('Enter a whole number from 0 to 100,000')).toBeVisible();
  await page.getByLabel('Before *').fill('14');
  await page.screenshot({ path: `${shots}/builder-trigger.png` });
});

test('Conditions: operators named for the field, several values, and the match count (AU-F21, F23)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new`);
  await page.getByLabel('Trigger Event *').selectOption({ label: 'Deadline Approaching' });
  await expect(page.getByTestId('condition-matches')).toContainText('records match right now');
  await page.getByRole('button', { name: 'Add Condition' }).click();
  const operator = page.getByLabel('Condition 1 operator');
  await expect(operator.locator('option')).toContainText(['Is', 'Is not']);
  await operator.selectOption({ label: 'Is any of' });
  await page
    .getByRole('group', { name: 'Condition 1 values' })
    .getByRole('checkbox')
    .first()
    .check();
  await expect(page.getByTestId('condition-matches')).toContainText('A count only; nothing runs.');
  await page.getByTestId('step-conditions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/builder-conditions.png` });
});

test('Actions move up and down with their settings, and a broken dependency clears (AU-F24)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new`);
  const add = page.getByRole('button', { name: 'Add Action' });
  await add.click();
  await add.click();
  await page.getByLabel('Action 1', { exact: true }).selectOption({ index: 1 });
  const second = await page.getByLabel('Action 2', { exact: true }).inputValue();
  const first = await page.getByLabel('Action 1', { exact: true }).inputValue();
  await page.getByLabel('Action 2 runs after').selectOption({ label: 'After action 1' });
  await expect(page.getByRole('button', { name: 'Move action 1 up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move action 2 down' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move action 2 up' }).click();
  await expect(page.getByLabel('Action 1', { exact: true })).toHaveValue(second);
  await expect(page.getByLabel('Action 2', { exact: true })).toHaveValue(first);
  // It ran after the action now below it: that can't stand, so it cleared, and moving it back
  // down doesn't bring it back.
  await page.getByRole('button', { name: 'Move action 1 down' }).click();
  await expect(page.getByLabel('Action 2', { exact: true })).toHaveValue(second);
  await expect(page.getByLabel('Action 2 runs after')).toHaveValue('');
  await page.getByTestId('step-actions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/builder-actions.png` });
});

test('an event with no client offers only Notify staff, with the members to notify (AU-F19, F27)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new`);
  await page.getByLabel('Trigger Category *').selectOption({ label: 'Staff Management' });
  await page.getByLabel('Trigger Event *').selectOption({ label: 'Team Member Added' });
  await expect(page.getByText('No conditions: it applies every time it happens.')).toBeVisible();
  await page.getByRole('button', { name: 'Add Action' }).click();
  const action = page.getByLabel('Action 1', { exact: true });
  // Only the action that needs no client: a task or a client message has nobody to act for.
  await expect(action.locator('option')).toHaveText(['Send internal notification']);
  await page.getByTestId('step-actions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/builder-notify.png` });
});

test('Logs: the activity tabs and the Status filter are one filter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/logs`);
  const tabs = page.getByRole('tablist', { name: 'Activity' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'All Activity',
    'Successful',
    'Failed',
    'Skipped',
    'Pending',
  ]);
  await tabs.getByRole('tab', { name: 'Failed' }).click();
  await expect(page.getByLabel('Status')).toHaveValue('failed');
  await page.getByLabel('Status').selectOption('skipped');
  await expect(tabs.getByRole('tab', { name: 'Skipped' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: `${shots}/logs-tabs.png` });
});
