import { expect, test } from '@playwright/test';

// R56 part 1: the Appointments pages under /calendar in mock mode (playwright.mock.config.ts runs
// every module on mock data as an Owner). The mock puts appointments around today, so the pages
// are full whatever day the test runs.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/calendar`;

test('List shows the table, the five cards filter it, search narrows it', async ({ page }) => {
  await page.goto(`${base}/list`);
  await expect(page.getByRole('heading', { name: 'Appointments', level: 1 })).toBeVisible();
  await expect(page.getByTestId('appointments-kpis').getByRole('button')).toHaveCount(5);
  const rows = page.getByTestId('list-card').getByRole('row');
  await expect(rows.nth(1)).toBeVisible();

  // A card keeps one status; the same card again clears it.
  await page.getByTestId('kpi-completed').click();
  await expect(
    page.getByTestId('list-card').getByText('Completed', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('list-card').getByText('Confirmed', { exact: true })).toHaveCount(
    0,
  );
  await page.getByTestId('kpi-completed').click();
  await expect(
    page.getByTestId('list-card').getByText('Confirmed', { exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel('Search appointments').fill('Lawson');
  await expect(page.getByTestId('list-card').getByTestId('appointment-link')).toHaveCount(1);
  await expect(page.getByTestId('list-card').getByTestId('appointment-link')).toHaveText(
    'Avery Lawson',
  );

  // The views are routes of one module.
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/today$/);
});

test('Today shows the day, moves day by day and keeps the rail', async ({ page }) => {
  await page.goto(`${base}/today`);
  await expect(page.getByTestId('day-label')).toContainText('Today');
  await expect(page.getByTestId('today-card')).toBeVisible();
  await expect(page.getByTestId('rail-today')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage Appointment Types' })).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByTestId('day-label')).not.toContainText('Today');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByTestId('day-label')).toContainText('Today');
});

test('New appointment: checks the fields, schedules, and opens the new record', async ({
  page,
}) => {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Schedule Appointment' })).toBeVisible();
  await expect(page.getByTestId('availability-panel')).toBeVisible();
  await expect(page.getByTestId('appointment-summary')).toBeVisible();

  // Nothing is sent while a required field is missing.
  await page.getByTestId('schedule-submit').click();
  await expect(
    page.getByText('Choose a client or lead, or add a new contact').first(),
  ).toBeVisible();
  await expect(page.getByText('Choose an appointment type').first()).toBeVisible();

  await page.getByTestId('contact-search').fill('Lawson');
  await page.getByRole('option', { name: /Avery Lawson/ }).click();
  await page.getByLabel('Appointment type').selectOption({ label: 'Consultation' });
  await page.getByLabel('Add staff member').selectOption({ label: 'Morgan Avery' });
  // A day well ahead: no conflict with the seeded week.
  await page.locator('#ap-date').fill('2027-03-02');
  await expect(page.getByTestId('conflict-card')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
  await expect(
    page.getByTestId('appointment-detail').getByRole('heading', { level: 1 }),
  ).toHaveText('Avery Lawson');
});

test('A new contact can be typed in and saved as a draft', async ({ page }) => {
  await page.goto(`${base}/new`);
  await page.getByTestId('contact-search').fill('Zed Newperson');
  await page.getByRole('button', { name: /Add “Zed Newperson” as a new contact/ }).click();
  await page.locator('#ap-email').fill('zed@example.test');
  await page.getByLabel('Appointment type').selectOption({ label: 'Follow-Up' });
  await page.getByLabel('Add staff member').selectOption({ label: 'Hana Kim' });
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('form-message')).toHaveText('Draft saved. Nothing was sent.');
});

test('Detail shows the record and a status change keeps it', async ({ page }) => {
  await page.goto(`${base}/list`);
  await page.getByTestId('list-card').getByTestId('appointment-link').first().click();
  await expect(page.getByTestId('appointment-detail')).toBeVisible();
  for (const id of [
    'detail-appointment',
    'detail-contact',
    'detail-notes',
    'detail-reminders',
    'detail-notices',
    'detail-history',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // Add a note, then mark it completed.
  await page.getByLabel('Add a note').fill('Called the client to confirm.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(page.getByText('Note added.')).toBeVisible();
  const complete = page.getByRole('button', { name: 'Mark Completed' });
  if (await complete.isVisible()) {
    await complete.click();
    await expect(page.getByText('Marked completed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark Completed' })).toHaveCount(0);
  }
});

test('Edit Existing opens the same form filled from the record', async ({ page }) => {
  await page.goto(`${base}/list`);
  const href = await page
    .getByTestId('list-card')
    .getByTestId('appointment-link')
    .first()
    .getAttribute('href');
  await page.goto(`http://app.localhost:${port}${href}/edit`);
  await expect(page.getByTestId('edit-appointment')).toBeVisible();
  await expect(page.getByTestId('contact-search')).not.toHaveValue('');
  await expect(page.getByLabel('Appointment type')).not.toHaveValue('');
  await page.getByLabel('Internal Notes (not visible to client)').fill('Edited in the form.');
  await page.getByTestId('schedule-submit').click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('detail-notes')).toContainText('Edited in the form.');
});

test('Appointment types: pick a type and save its settings', async ({ page }) => {
  await page.goto(`${base}/types`);
  await expect(page.getByTestId('type-list').getByRole('button')).not.toHaveCount(0);
  await page
    .getByTestId('type-list')
    .getByRole('button', { name: /Tax Preparation/ })
    .click();
  await expect(page.getByTestId('type-config')).toContainText('Tax Preparation');
  await page.getByLabel('Description').fill('Preparing the yearly return.');
  await page.getByTestId('type-save').click();
  await expect(page.getByText('Type settings saved.')).toBeVisible();
  await expect(page.getByTestId('notice-card')).toContainText('Main email');
});

test('Staff availability: the day, the weekly hours and the booking rules', async ({ page }) => {
  await page.goto(`${base}/availability`);
  await expect(page.getByTestId('availability-panel')).toBeVisible();
  await expect(page.getByTestId('availability-rows').getByRole('listitem').first()).toBeVisible();
  await expect(page.getByTestId('rules-editor')).toBeVisible();
  await expect(page.getByText('Weekly Working Hours')).toBeVisible();
  await page.getByLabel('Buffer before').fill('10');
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.getByText('Availability saved.')).toBeVisible();
});

test('No sideways scroll at 375 px on any of the pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['list', 'today', 'new', 'types', 'availability']) {
    await page.goto(`${base}/${path}`);
    await expect(page.locator('main, [data-testid]').first()).toBeVisible();
    await page.waitForTimeout(600);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path).toBeLessThanOrEqual(1);
  }
});
