import { expect, test } from '@playwright/test';

// R56: Octavia's Business Advisory review of Oct 24 to 25 (docs/specs/review-2026-10-25/
// CHANGE-LIST.md, section B), batch 1 (B4 to B9), in mock mode as an Owner. The mock keeps its
// data in the page, so a test moves between pages by their links.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const base = `${app}/business-advisory`;
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test('B4: Schedule Meeting carries the client, the advisory engagement and the way back', async ({
  page,
}) => {
  await page.goto(`${base}/clients/${MARCUS}`);
  const link = page.getByTestId('schedule-meeting');
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(
      `^/calendar/new\\?clientId=[0-9a-f-]{36}&engagementId=[0-9a-f-]{36}&from=%2Fbusiness-advisory%2Fclients%2F${MARCUS}$`,
    ),
  );
});

test('B5: Upcoming Advisory Meetings opens Appointments on the advisory meetings, the rest a click away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await expect(
    page.getByRole('link', { name: /Upcoming Advisory Meetings/ }).first(),
  ).toHaveAttribute('href', '/calendar/list?serviceKind=BUSINESS_DEVELOPMENT');
  await page.goto(`${app}/calendar/list?serviceKind=BUSINESS_DEVELOPMENT`);
  await expect(page.getByRole('heading', { name: 'Business Advisory Meetings' })).toBeVisible();
  await expect(page.getByTestId('advisory-filter')).toContainText(
    'Business Advisory meetings only',
  );
  await page.screenshot({ path: test.info().outputPath('advisory-meetings.png') });
  await page.getByRole('button', { name: 'Show all appointments' }).click();
  await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible();
  await expect(page.getByTestId('advisory-filter')).toHaveCount(0);
});

test('B6: Other entity type and industry ask what it is, and refuse to go on without it', async ({
  page,
}) => {
  await page.goto(`${base}/plans/new?advisoryClientId=0199c0f1-a200-7000-8000-000000000002`);
  await page.getByLabel('Entity Type').selectOption('Other');
  await page.getByLabel('Industry').selectOption('Other');
  await expect(page.getByLabel('Specify entity type')).toBeVisible();
  await expect(page.getByLabel('Specify industry')).toBeVisible();
  await page
    .getByRole('button', { name: /Save & Continue|Continue|Next/ })
    .first()
    .click();
  await expect(page.getByText('Say what it is to continue').first()).toBeVisible();
  await page.getByLabel('Specify entity type').fill('Cooperative');
  await page.getByLabel('Specify industry').fill('Agriculture');
  await expect(page.getByLabel('Specify entity type')).toHaveValue('Cooperative');
});

test('B7 and B8: all eight goal statuses, progress follows the status; milestones have an owner and progress', async ({
  page,
}) => {
  await page.goto(`${base}/goals`);
  const list = page.getByTestId('ba-goals');
  await list.getByTestId('goal-link').filter({ hasText: 'Increase annual revenue by 25%' }).click();
  const form = page.getByTestId('edit-goal');
  const status = form.getByLabel('Status', { exact: true });
  await expect(status.locator('option')).toHaveCount(8);
  await status.selectOption('COMPLETED');
  await expect(form.getByLabel('Progress (%)')).toHaveValue('100');
  await expect(form.getByLabel('Progress (%)')).toHaveAttribute('readonly', '');
  await status.selectOption('PLANNING');
  await expect(form.getByLabel('Progress (%)')).not.toHaveAttribute('readonly', '');
  await expect(form.getByLabel('Progress (%)')).not.toHaveValue('100');

  const rows = form.getByTestId('milestone-row');
  await expect(rows.first().getByRole('combobox')).toHaveCount(3);
  await form.getByLabel('Progress of Launch referral program').selectOption('50');
  await expect(form.getByLabel('Progress of Launch referral program')).toHaveValue('50');
  await page.screenshot({ path: test.info().outputPath('goal-milestones.png'), fullPage: true });
});

test('B9: a finalized plan offers Modify Plan, not Edit; a version opens as a snapshot', async ({
  page,
}) => {
  await page.goto(`${base}/plans`);
  const list = page.getByTestId('ba-plans');
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Finalize Plan' }).click();
  await expect(page.getByText('Fleet Expansion Plan finalized.')).toBeVisible();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await expect(page.getByRole('menuitem', { name: 'Modify Plan' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit Plan' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Version History' }).click();
  await page.getByTestId('view-snapshot').first().click();
  await expect(page.getByTestId('plan-snapshot')).toContainText('Version 1');
  await expect(page.getByTestId('plan-snapshot')).toContainText('read only');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Modify Plan' }).click();
  await expect(page).toHaveURL(/\/business-advisory\/plans\/[0-9a-f-]{36}\/edit/);
});
