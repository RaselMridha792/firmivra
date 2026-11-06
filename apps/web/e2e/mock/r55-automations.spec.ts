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
