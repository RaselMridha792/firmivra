import { expect, test } from '@playwright/test';

// R56: Octavia's Dashboard Review Two, the rows still open after the check (F: checks, not in the
// repo), in mock mode as an Owner. The mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('§9: a task’s page shows its reminder history: who it reaches, when it goes next, what went out', async ({
  page,
}) => {
  await page.goto(app('/tasks/0199c0f0-0a10-7000-8000-000000000001'));
  const history = page.getByTestId('reminder-history');
  await expect(history).toBeVisible({ timeout: 60_000 });
  await expect(history.getByTestId('reminder-recipients')).toContainText('Goes to:');
  await expect(history.getByTestId('reminder-recipients')).toContainText('never the client');
  await expect(history.getByTestId('reminder-recipients')).toContainText('America/New_York');
  // The reminder that went out: when, to whom, the bell read, the email sent with its id.
  const sent = history.getByTestId('reminder-sent').getByRole('listitem').first();
  await expect(sent).toContainText('Bell: read');
  await expect(sent).toContainText('Email:');
  await expect(sent).toContainText('Sent');
  await expect(sent).toContainText('ID mock-0100');
});

test('V5: a card or widget whose module the member may not view says so, with no number or link', async ({
  page,
}) => {
  // The member's Invoices & Payments and Tasks views are off (a custom role or their own change).
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-no-view', 'INVOICES_PAYMENTS,TASKS'),
  );
  await page.goto(app('/'));
  const outstanding = page.getByTestId('kpi-card').filter({ hasText: 'Outstanding Invoices' });
  await expect(outstanding).toContainText("You don't have access to Invoices & Payments.", {
    timeout: 60_000,
  });
  await expect(outstanding.getByRole('link')).toHaveCount(0);
  await expect(page.getByTestId('kpi-card').filter({ hasText: 'Total Clients' })).toContainText(
    /\d/,
  );
  for (const title of ['Revenue Overview', 'Service Breakdown'])
    await expect(page.getByRole('region', { name: title })).toContainText(
      "You don't have access to Invoices & Payments.",
    );
  const tasks = page.getByRole('region', { name: 'Tasks Due' });
  await expect(tasks).toContainText("You don't have access to Tasks.");
  await expect(tasks.getByRole('link', { name: 'View All' })).toHaveCount(0);
});

test('V8: the lists do not wait for the availability call: with it failing they still load', async ({
  page,
}) => {
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-fail', 'availability.get'));
  await page.goto(app('/'));
  for (const title of ['Recent Messages', 'Tasks Due', 'Upcoming Appointments'])
    await expect(page.getByRole('region', { name: title })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("We couldn't load messages and appointments.")).toHaveCount(0);
});

test('K8: a number that fell says Down with the percentage, and that it is unfavourable', async ({
  page,
}) => {
  await page.goto(app('/'));
  await page.getByRole('combobox', { name: 'Dashboard period' }).selectOption('LAST_YEAR');
  // Last year: 207 new leads against 292 the year before.
  await expect(page.getByTestId('kpi-card').filter({ hasText: 'New Leads' })).toContainText(
    'Down 29%, unfavourable',
    { timeout: 60_000 },
  );
});

test('K2, V9, R2 NEW6: Back to Dashboard returns to the same place on the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(app('/'));
  const tasks = page.getByRole('region', { name: 'Tasks Due' });
  const viewAll = tasks.getByRole('link', { name: 'View All' });
  await expect(viewAll).toBeVisible({ timeout: 60_000 });
  await tasks.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(200);
  await viewAll.click();
  await expect(page).toHaveURL(/\/tasks\?/);
  await page.getByTestId('back-to-origin').click();
  await expect(page.getByTestId('firm-dashboard')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 60);
});

test('T1, B07: a message preview opens that client’s conversation, with Back to Dashboard', async ({
  page,
}) => {
  await page.goto(app('/'));
  const preview = page
    .getByRole('region', { name: 'Recent Messages' })
    .getByRole('listitem')
    .first()
    .getByRole('link');
  await expect(preview).toHaveAttribute('href', /^\/clients\/[^/?]+\/messages\?from=%2F/, {
    timeout: 60_000,
  });
  await preview.click();
  // The first visit compiles the page in dev mode: give it time.
  await expect(page).toHaveURL(/\/clients\/[^/?]+\/messages\?from=%2F/, { timeout: 60_000 });
  await page.getByTestId('back-to-origin').click();
  await expect(page.getByTestId('firm-dashboard')).toBeVisible();
});

test('V6: a task that cannot be completed, or a reminder that cannot be sent, says so', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-fail', 'tasks.update,scheduling.sendReminder'),
  );
  await page.goto(app('/'));
  const tasks = page.getByRole('region', { name: 'Tasks Due' });
  const box = tasks.getByRole('checkbox').first();
  await expect(box).toBeVisible({ timeout: 60_000 });
  const title = ((await box.getAttribute('aria-label')) ?? '').replace(/^Mark | complete$/g, '');
  // The box opens Mark this task complete? (it is ticked only while the change is saved).
  await box.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark Complete' }).click();
  await expect(tasks.getByRole('alert')).toContainText('The task could not be marked complete');
  await expect(tasks).toContainText(title);

  const appointments = page.getByRole('region', { name: 'Upcoming Appointments' });
  await appointments
    .getByRole('button', { name: /^Actions for/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Send Reminder' }).click();
  await expect(appointments.getByRole('status')).toContainText('The reminder was not sent');
});

test('OPT1: Custom with a blank date says what applies it, and the period shown stays', async ({
  page,
}) => {
  await page.goto(app('/'));
  await page.getByRole('combobox', { name: 'Dashboard period' }).selectOption('CUSTOM');
  const dates = page.getByTestId('custom-dates').first();
  const hint = dates.getByTestId('custom-hint');
  await expect(hint).toHaveText(
    'Choose both dates to apply this period; until then the current one stays.',
    { timeout: 60_000 },
  );
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  await dates.getByLabel('From').fill(day(7));
  await expect(hint).toBeVisible();
  await dates.getByLabel('To').fill(day(1));
  await expect(hint).toHaveCount(0);
});

test('B11: + New keeps the way back only when it leaves the page; the page already open adds none', async ({
  page,
}) => {
  await page.goto(app('/'));
  const menu = page.getByRole('button', { name: 'New' });
  await menu.click();
  await page.getByRole('menuitem', { name: 'New task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?from=%2F$/, { timeout: 60_000 });
  await expect(page.getByTestId('back-to-origin')).toBeVisible();
  // From the page it opens, the same item is the plain page: no way back is added.
  await menu.click();
  await page.getByRole('menuitem', { name: 'New task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
});
