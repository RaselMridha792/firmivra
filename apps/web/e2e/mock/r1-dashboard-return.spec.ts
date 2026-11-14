import { expect, type Page, test } from '@playwright/test';

// Dashboard Review 2 (R1): K2 and V9 (Back to Dashboard keeps the chosen period), T2 (Tasks Due
// View All opens the widget's tasks), R2 NEW6 and NEW7 (the real origin, never Home, and no origin
// on a direct visit) and C5 (Intake opens its filter as the selected tab). Mock mode, the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function dashboardOn(page: Page, period: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  await page.getByLabel('Dashboard period').selectOption({ label: period });
  await expect(page).toHaveURL(app('/?period=LAST_MONTH'));
}

test('a card keeps the chosen period: Back to Dashboard returns to it', async ({ page }) => {
  test.setTimeout(120_000);
  await dashboardOn(page, 'Last Month');
  await page.getByTestId('kpi-card').filter({ hasText: 'Total Clients' }).click();
  await expect(page).toHaveURL(/\/clients\?/, { timeout: 60_000 });
  await page.getByTestId('back-to-dashboard').click();
  await expect(page).toHaveURL(app('/?period=LAST_MONTH'), { timeout: 60_000 });
  await expect(page.getByLabel('Dashboard period')).toHaveValue('LAST_MONTH');
});

test("Tasks Due View All opens the widget's tasks, with the way back to the dashboard", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await dashboardOn(page, 'Last Month');
  await page
    .getByRole('region', { name: 'Tasks Due' })
    .getByRole('link', { name: 'View All' })
    .click();
  await expect(page).toHaveURL(/\/tasks\?view=all&due=set&from=/, { timeout: 60_000 });
  await expect(page.getByRole('tab', { name: 'All Tasks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('due-set-filter')).toContainText(
    'Tasks with a due date, soonest first.',
  );
  // The real origin, not Home (R2 NEW7).
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/?period=LAST_MONTH'), { timeout: 60_000 });
  await expect(page.getByLabel('Dashboard period')).toHaveValue('LAST_MONTH');
});

test('Tasks opened from the sidebar shows no origin', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tasks'));
  await expect(page.getByTestId('tasks-page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
  await expect(page.getByTestId('due-set-filter')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'My Tasks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the Intake stage opens Not Finished as the selected filter', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  await page
    .getByRole('region', { name: 'Client Pipeline' })
    .getByRole('link', { name: /^Intake: / })
    .click();
  await expect(page).toHaveURL(/\/intake-forms\?tab=open&back=dashboard/, { timeout: 60_000 });
  await expect(page.getByRole('tab', { name: 'Not Finished' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'All Forms' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
});

test("a past period's Total Clients opens the books at its end; Show today clears it (K1)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await dashboardOn(page, 'Last Month');
  const card = page.getByTestId('kpi-card').filter({ hasText: 'Total Clients' });
  await expect(card).toHaveAttribute('href', /^\/clients\?asOf=\d{4}-\d{2}-\d{2}&back=dashboard$/);
  await card.click();
  const asOf = page.getByTestId('as-of-filter');
  await expect(asOf).toContainText('On the books at the end of', { timeout: 60_000 });
  await expect(page).toHaveURL(/[?&]asOf=\d{4}-\d{2}-\d{2}/);
  await asOf.getByRole('button', { name: 'Show the clients on the books today' }).click();
  await expect(asOf).toHaveCount(0);
});

test("Tax Returns shows a past period's statuses as they stood then (K4)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?status=IN_PROGRESS&asOf=2026-10-31&back=dashboard'));
  const asOf = page.getByTestId('as-of-filter');
  await expect(asOf).toContainText('Status as it stood at the end of', { timeout: 60_000 });
  await asOf.getByRole('button', { name: "Show each return's status today" }).click();
  await expect(asOf).toHaveCount(0);
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
});

test('Create Bulk Email opens the composer; its first save makes the draft and keeps Back (Q3)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  await page.getByRole('link', { name: 'Create Bulk Email' }).click();
  await expect(page.getByTestId('composer-form')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/communications\/new\?channel=EMAIL&from=%2F$/);
  await expect(page.getByTestId('save-state')).toHaveText('Not saved yet');
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
  await page.getByLabel('Campaign Name').fill('Fake spring update');
  await page.getByRole('button', { name: 'Save Draft' }).first().click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page).toHaveURL(/\/communications\/[0-9a-f-]{36}\/edit\?from=%2F$/);
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
});
