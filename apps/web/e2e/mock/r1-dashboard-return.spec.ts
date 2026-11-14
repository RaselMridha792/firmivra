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

test.describe('a browser in Central time', () => {
  test.use({ timezoneId: 'America/Chicago' });
  test("the header clock shows the firm's time zone, not the browser's (U2)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(app('/'));
    // The mock firm keeps America/New_York (Settings > Preferences).
    const clock = page.getByTestId('header-clock');
    await expect(clock).toHaveAttribute('title', 'Time zone: America/New_York', {
      timeout: 60_000,
    });
    await expect(clock).toContainText(/ (EST|EDT) /);
  });
});

test('the profile menu closes on a click outside and on Escape after focus left it (R2 NEW1)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  const trigger = page
    .getByRole('button', { name: /Mock/ })
    .filter({ has: page.getByText('Owner') });
  const menu = page.getByRole('menu').filter({ has: page.getByTestId('me-email') });
  await trigger.click({ timeout: 60_000 });
  await expect(menu).toBeVisible();
  await page.getByTestId('page-title').click();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(app('/'));

  await trigger.click();
  await expect(menu).toBeVisible();
  // Focus leaves the menu for the page; Escape still closes it.
  await page.getByRole('region', { name: 'Key numbers' }).getByRole('combobox').focus();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The button still toggles it, and Escape from inside returns focus to the button.
  await trigger.click();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem').first().focus();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
