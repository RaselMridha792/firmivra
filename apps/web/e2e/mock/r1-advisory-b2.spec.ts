import { expect, test } from '@playwright/test';

// R1, Business Advisory Review 2 batch B (the lead's list, A-xx). Mock mode as the Owner; the
// mock keeps its data in the page, so a test moves between pages by their links. Synthetic data
// only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test.describe.configure({ timeout: 240_000 });

test('A-NEW2: View History lists every client’s changes, filters by client and area, and opens each record', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory'));
  await page.getByRole('tab', { name: 'View History' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/business-advisory\/history$/, { timeout: 60_000 });
  const history = page.getByTestId('ba-history');
  const links = history.getByTestId('history-link');
  await expect(links.first()).toBeVisible({ timeout: 60_000 });
  // Every client's changes: more than one client is named.
  await expect(
    history.getByRole('cell', { name: 'Added to the advisory program' }),
  ).not.toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();
  await expect(history.getByRole('cell', { name: 'Advisory clients' }).first()).toBeVisible();

  // One area: plans only.
  await history.getByLabel('Area', { exact: true }).selectOption('PLAN');
  await expect(history.getByRole('cell', { name: 'Advisory clients' })).toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();

  // One client: theirs only.
  await history.getByLabel('Client', { exact: true }).selectOption(MARCUS);
  await expect(history.getByRole('cell', { name: 'Plan finalized' })).toBeVisible({
    timeout: 60_000,
  });
  // Their plan's three changes: started, finalized and sent.
  await expect(links).toHaveCount(3);

  // An entry opens its record: a plan change opens the client's plan.
  await history.getByRole('link', { name: 'Plan finalized' }).click();
  await expect(page).toHaveURL(new RegExp(`/business-advisory/clients/${MARCUS}/plan$`), {
    timeout: 60_000,
  });
});

test('A-X11: Edit Action Item opens the item’s form with its client fixed, and saves the changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/action-plans'));
  await page.getByLabel('Search action items').fill('Prepare funding', { timeout: 60_000 });
  await page
    .getByRole('button', { name: 'Actions for Prepare funding application' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Edit Action Item' }).click();
  const dialog = page.getByTestId('edit-action-item');
  const title = dialog.getByLabel(/^Action item/);
  await expect(title).toHaveValue('Prepare funding application');
  await expect(dialog.getByLabel(/^Advisory client/)).toBeDisabled();
  await expect(dialog.getByLabel(/^Priority/)).toHaveValue('HIGH');
  await title.fill('Prepare the SBA funding application');
  await dialog.getByLabel(/^Priority/).selectOption('NORMAL');
  await page.getByRole('button', { name: 'Save Action Item' }).click();
  await expect(
    page.getByText('Action item saved: Prepare the SBA funding application'),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Search action items').fill('SBA funding');
  await expect(page.getByRole('cell', { name: 'Prepare the SBA funding application' })).toBeVisible(
    { timeout: 60_000 },
  );
});

test('A-X11: Cancel Meeting on the client’s Meetings tab asks for a reason, then cancels the appointment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}/meetings`));
  const upcoming = page.getByTestId('tab-upcoming-meetings');
  await upcoming
    .getByRole('button', { name: 'Cancel the meeting: Strategy Review' })
    .click({ timeout: 60_000 });
  const dialog = page.getByTestId('cancel-meeting');
  await expect(dialog).toBeVisible();
  // The reason is required.
  await page.getByRole('button', { name: 'Cancel Meeting', exact: true }).click();
  await expect(dialog.getByText('Enter the reason for canceling')).toBeVisible();
  await dialog.getByLabel(/^Reason for canceling/).fill('The client asked to meet next month.');
  await page.getByRole('button', { name: 'Cancel Meeting', exact: true }).click();
  await expect(page.getByText(/^Meeting canceled: Strategy Review/)).toBeVisible({
    timeout: 60_000,
  });
  // The appointment is canceled, so it is no upcoming meeting any more.
  await expect(upcoming.getByText('Strategy Review')).toHaveCount(0, { timeout: 60_000 });
});

test('A-X07: Recurrence takes every n weeks, the weekdays and an end date, and says so before saving', async ({
  page,
}) => {
  // The mock's bookings are at a fixed -04:00 offset.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  const recurrence = page.getByTestId('recurrence');
  const summary = page.getByTestId('appointment-summary');
  await recurrence.getByLabel('Repeat').selectOption('WEEKLY');
  await recurrence.getByLabel('Every').selectOption('2');
  const days = recurrence.getByTestId('repeat-weekdays');
  await days.getByLabel('Mon').check();
  await days.getByLabel('Wed').check();
  await recurrence.getByLabel('Occurrences').selectOption('6');
  await expect(summary).toContainText('Every 2 weeks on Mon, Wed, 6 times');
  // Ends on a date: the date is needed, and the summary names it.
  await recurrence.getByLabel('Ends').selectOption('UNTIL');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(recurrence.getByText('Choose the date the series ends.')).toBeVisible();
  await recurrence.getByLabel('End date').fill('2026-12-31');
  await expect(summary).toContainText('Every 2 weeks on Mon, Wed, until Dec 31, 2026');
  // Monthly: every n months, no weekdays.
  await recurrence.getByLabel('Repeat').selectOption('MONTHLY');
  await expect(recurrence.getByTestId('repeat-weekdays')).toHaveCount(0);
  await expect(summary).toContainText('Every 2 months, until Dec 31, 2026');
});

test('A-X07: a client whose texts are stopped gets no text reminder, and the form says why', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const pick = async (first: string, full: RegExp) => {
    await page.goto(app('/calendar/new'));
    await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Client / Lead *').fill(first);
    await page.getByTestId('contact-results').getByRole('button', { name: full }).click();
  };
  const reminders = page.getByTestId('client-reminders');
  const sms = reminders.getByLabel('SMS Reminder', { exact: true });

  // The mock's Grace Pruitt replied STOP.
  await pick('Grace', /Grace Pruitt/);
  await expect(reminders.getByTestId('sms-stopped')).toHaveText(
    'No text reminder: they stopped texts (a STOP reply or an unsubscribe).',
  );
  await expect(sms).toBeDisabled();
  await expect(sms).not.toBeChecked();

  // Another client gets the text reminder as before.
  await pick('Clara', /Clara Voss/);
  await expect(reminders.getByTestId('sms-stopped')).toHaveCount(0);
  await expect(sms).toBeEnabled();
});
