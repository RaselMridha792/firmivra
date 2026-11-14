import { expect, test } from '@playwright/test';

// R56: Octavia's Appointments review of Oct 20 (docs/specs/review-2026-10-21/CHANGE-LIST.md,
// section B), P1 items in mock mode. A2: Edit My Availability saves the weekly hours and time
// off together, marks a wrong field, and shows the firm's buffers, notice and window instead of
// sending values the API refuses per person. A1: a refused meeting-method choice is named on
// its field, and every entry stays. The scheduling mock refuses what the API refuses.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('A2: weekly hours and time off save together, and reload into the form', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/availability'));
  const rules = page.getByTestId('availability-rules');
  const week = rules.getByTestId('week-hours');
  await expect(week).toBeVisible({ timeout: 60_000 });
  await expect(rules.getByTestId('booking-rules')).toContainText('Booking window');
  await expect(rules.getByLabel('Minimum notice')).toHaveCount(0);

  await week.getByRole('button', { name: 'Add hours on Saturday' }).click();
  await week.getByLabel('Saturday to').fill('13:00');
  await rules.getByRole('button', { name: 'Add Time Off' }).click();
  await rules.getByLabel('From').last().fill('2026-12-21');
  await rules.getByLabel('To').last().fill('2026-12-24');
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(page.getByTestId('rules-saved')).toHaveText('Availability saved.');

  // The form is drawn again from what the API returned.
  await expect(week.getByLabel('Saturday from')).toHaveValue('09:00');
  await expect(week.getByLabel('Saturday to')).toHaveValue('13:00');
  await expect(rules.getByLabel('To').last()).toHaveValue('2026-12-24');
});

test('A2: a wrong range is marked on its field and focused, and nothing is sent', async ({
  page,
}) => {
  await page.goto(app('/calendar/availability'));
  const rules = page.getByTestId('availability-rules');
  const week = rules.getByTestId('week-hours');
  await expect(week).toBeVisible({ timeout: 60_000 });
  await week.getByRole('button', { name: 'Add hours on Sunday' }).click();
  await week.getByLabel('Sunday to').fill('08:00');
  await rules.getByRole('button', { name: 'Save Availability' }).click();

  await expect(week.getByLabel('Sunday to')).toHaveAttribute('aria-invalid', 'true');
  await expect(week.getByText('The end must be after the start.')).toBeVisible();
  await expect(week.getByLabel('Sunday to')).toBeFocused();
  await expect(rules.getByTestId('rules-problems')).toHaveText(
    'Fix the highlighted field before saving.',
  );
  await expect(page.getByTestId('rules-saved')).toHaveCount(0);

  await week.getByLabel('Sunday to').fill('12:00');
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(page.getByTestId('rules-saved')).toHaveText('Availability saved.');
});

test('A1 and Review 2 (P1 row 1): several methods save together; Other Video Meeting names its platform', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  // The first active type's settings open with the page.
  const methods = page.getByTestId('meeting-methods');
  await expect(methods).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Description').fill('Internal note for staff.');
  await methods.getByLabel('Phone').check();
  await methods.getByLabel('Other Video Meeting').check();
  // Without its platform: named on that field, the other entries kept, no one-method rule.
  await page.getByRole('button', { name: 'Save Settings' }).click();
  const platform = page.getByTestId('other-video-platform');
  await expect(platform).toContainText('Name the video platform of the Other Video Meeting.');
  await expect(methods).not.toContainText('keeps one meeting method');
  await expect(page.getByLabel('Description')).toHaveValue('Internal note for staff.');
  await expect(methods.getByLabel('Phone')).toBeChecked();

  await platform.getByLabel('Video platform *').fill('Google Meet');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');

  // Another type and back: read again, every method and the platform kept.
  const types = page.locator('button[aria-pressed]');
  await types.nth(1).click();
  await expect(types.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await types.nth(0).click();
  await expect(types.nth(0)).toHaveAttribute('aria-pressed', 'true');
  for (const label of ['In-Person', 'Phone', 'Other Video Meeting'])
    await expect(methods.getByLabel(label)).toBeChecked();
  await expect(platform.getByLabel('Video platform *')).toHaveValue('Google Meet');
});

test('A3, A10 and Review 2 (P1 row 2): the window in hours or days, notice in hours, all kept; the description is staff only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  const windowDays = page.getByLabel('Booking window');
  const notice = page.getByLabel('Minimum notice');
  await expect(windowDays).toBeVisible({ timeout: 60_000 });

  // Review 2: 2, 6 and 12 hours, then her 1, 3, 5 and 7 days and No limit.
  expect(await windowDays.locator('option').allTextContents()).toEqual([
    '2 hours ahead',
    '6 hours ahead',
    '12 hours ahead',
    '1 day ahead (24 hours)',
    '3 days ahead',
    '5 days ahead',
    '7 days ahead',
    '14 days ahead',
    '30 days ahead',
    '60 days ahead',
    '90 days ahead',
    '180 days ahead',
    '365 days ahead',
    'No limit',
  ]);
  expect(await notice.locator('option').allTextContents()).toEqual([
    'None',
    '2 hours',
    '6 hours',
    '12 hours',
    '24 hours',
    '48 hours',
    '72 hours',
  ]);
  await expect(page.getByLabel('Description (staff only)')).toBeVisible();
  await expect(page.getByTestId('type-description-note')).toHaveText(
    'For your team only: clients never see it, in the portal, booking or emails.',
  );

  await windowDays.selectOption('h6');
  await notice.selectOption('2');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');

  // Another type and back: the settings are read again from the API, each value in its field.
  const types = page.locator('button[aria-pressed]');
  await types.nth(1).click();
  await expect(types.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await types.nth(0).click();
  await expect(types.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(windowDays).toHaveValue('h6');
  await expect(notice).toHaveValue('2');
  // A day choice replaces the hours, and stays.
  await windowDays.selectOption('d3');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');
  await types.nth(1).click();
  await types.nth(0).click();
  await expect(windowDays).toHaveValue('d3');
});

test('A6: the video link has its own full-width row, the toggle on its label line, and Copy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole('radiogroup', { name: 'Location Type *' })
    .getByRole('radio', { name: 'Zoom / Video' })
    .click();

  const row = page.getByTestId('video-link');
  const link = row.getByRole('textbox', { name: 'Video Meeting Link' });
  const copy = row.getByRole('button', { name: 'Copy the video link' });
  await expect(link).toBeEnabled();
  await expect(copy).toBeDisabled();

  // The link and Copy span the row that Office / Branch and Room share above it.
  const office = await page.getByLabel('Office / Branch').boundingBox();
  const room = await page.getByLabel('Room (optional)').boundingBox();
  const field = await link.boundingBox();
  const button = await copy.boundingBox();
  expect(office && room && field && button).toBeTruthy();
  expect(Math.abs(field!.x - office!.x)).toBeLessThan(2);
  expect(Math.abs(button!.x + button!.width - (room!.x + room!.width))).toBeLessThan(2);

  // The toggle sits on the label's line, above the field.
  const label = await row.getByText('Video Meeting Link', { exact: true }).first().boundingBox();
  const toggle = await row.getByRole('switch', { name: 'Generate Zoom Link' }).boundingBox();
  expect(Math.abs(label!.y + label!.height / 2 - (toggle!.y + toggle!.height / 2))).toBeLessThan(6);
  expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(field!.y);

  await link.fill('https://meet.example.test/abc-defg');
  await expect(copy).toBeEnabled();
});

test('A7: several default reminders, each with its channels, kept after reopening', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  const box = page.getByTestId('type-reminders');
  await expect(box).toBeVisible({ timeout: 60_000 });
  const rows = box.getByTestId('type-reminder');
  await expect(rows).toHaveCount(1);
  await expect(page.getByLabel('Reminder 1 unit')).toHaveValue('DAYS');

  // A second reminder, 2 hours before, by SMS and Portal only.
  await box.getByRole('button', { name: 'Add Reminder' }).click();
  await page.getByLabel('Reminder 2 amount').fill('2');
  const second = box.getByRole('group', { name: 'Reminder 2 channels' });
  await second.getByLabel('Email').uncheck();
  await second.getByLabel('SMS').check();
  await second.getByLabel('Portal').check();

  // A third with no channel is refused before anything is sent.
  await box.getByRole('button', { name: 'Add Reminder' }).click();
  await box.getByRole('group', { name: 'Reminder 3 channels' }).getByLabel('Email').uncheck();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(box).toContainText('Choose Email, SMS or Portal for reminder 3.');
  await expect(page.getByTestId('type-settings-saved')).toHaveCount(0);
  await box.getByRole('button', { name: 'Remove reminder 3' }).click();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');

  // Another type and back: both reminders as they were saved.
  const types = page.locator('button[aria-pressed]');
  await types.nth(1).click();
  await expect(types.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await types.nth(0).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel('Reminder 1 amount')).toHaveValue('1');
  await expect(page.getByLabel('Reminder 1 unit')).toHaveValue('DAYS');
  await expect(page.getByLabel('Reminder 2 amount')).toHaveValue('2');
  await expect(page.getByLabel('Reminder 2 unit')).toHaveValue('HOURS');
  const back = box.getByRole('group', { name: 'Reminder 2 channels' });
  await expect(back.getByLabel('Email')).not.toBeChecked();
  await expect(back.getByLabel('SMS')).toBeChecked();
  await expect(back.getByLabel('Portal')).toBeChecked();
});

test('A5: Save Client saves the typed contact as a client and chooses it; entries stay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  // Scheduling details first, so they can be checked afterwards.
  await page.getByLabel('Appointment Type *').selectOption({ index: 1 });
  await page.getByLabel('Date *').fill('2026-12-03');
  await page.getByLabel('Internal Notes').fill('Bring last year return');

  await page.getByRole('button', { name: 'Add a new contact' }).click();
  const info = page.getByTestId('client-information');
  await info.getByRole('button', { name: 'Save Client' }).click();
  await expect(page.getByTestId('save-client-note')).toHaveText('Enter the name first.');

  await info.getByLabel('Name *').fill('Riley Sample');
  await info.getByLabel('Email *').fill('jamie.sample@example.test');
  await info.getByRole('button', { name: 'Save Client' }).click();
  await expect(page.getByTestId('save-client-error')).toContainText(
    'Another client already has this email',
  );

  await info.getByLabel('Email *').fill('riley.sample@example.test');
  await info.getByRole('button', { name: 'Save Client' }).click();
  await expect(page.getByTestId('save-client-note')).toHaveText(
    'Riley Sample is saved as a client and chosen for this appointment.',
  );
  await expect(page.getByLabel('Client / Lead *')).toHaveValue('Riley Sample');
  await expect(info.getByRole('link', { name: 'View Client Profile' })).toBeVisible();
  await expect(page.getByLabel('Date *')).toHaveValue('2026-12-03');
  await expect(page.getByLabel('Internal Notes')).toHaveValue('Bring last year return');
  await expect(page.getByLabel('Appointment Type *')).not.toHaveValue('');
});

test("Schedule Appointment starts from the chosen type's reminders; edits by hand stay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  const card = page.getByTestId('client-reminders');

  // The mock's types start with one default: an email a day before.
  await page.getByLabel('Appointment Type *').selectOption({ index: 1 });
  await expect(card.getByTestId('reminder-defaults-note')).toContainText("'s default reminders.");
  await expect(card.getByLabel('Email Reminder', { exact: true })).toBeChecked();
  await expect(card.getByLabel('Email Reminder amount')).toHaveValue('1');
  await expect(card.getByLabel('Email Reminder unit')).toHaveValue('DAYS');
  await expect(card.getByLabel('SMS Reminder', { exact: true })).not.toBeChecked();
  await expect(card.getByLabel('Portal Notification', { exact: true })).not.toBeChecked();

  // Changed by hand, the rows stay when another type is chosen.
  await card.getByLabel('Email Reminder amount').selectOption('2');
  await expect(card.getByTestId('reminder-defaults-note')).toHaveCount(0);
  await page.getByLabel('Appointment Type *').selectOption({ index: 2 });
  await expect(card.getByLabel('Email Reminder amount')).toHaveValue('2');
  await expect(card.getByTestId('reminder-defaults-note')).toHaveCount(0);
});

test('A9: a type names its intake form; the appointment sends it and shows it waiting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  const intake = page.getByTestId('type-intake');
  await expect(intake).toBeVisible({ timeout: 60_000 });
  await intake.getByLabel('Required intake form').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');

  // A client's appointment (mock appointment 1) sends one and then shows it, waiting.
  await page.goto(app('/calendar/0199c0b0-0a10-7000-8000-000000000001'));
  await page.getByTestId('send-intake').click();
  const dialog = page.getByTestId('send-intake-dialog');
  await dialog.getByLabel('Form').selectOption({ index: 1 });
  await expect(dialog.getByLabel('Subject')).toHaveValue(/before your appointment$/);
  await page.screenshot({ path: test.info().outputPath('send-intake.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Send Form' }).click();
  await expect(page.getByTestId('detail-result')).toContainText('Intake form sent');
  await expect(page.getByTestId('detail-related')).toContainText('(waiting)');
  await expect(page.getByTestId('send-intake')).toHaveCount(0);
});

test('Review 2 (Save as Draft): a draft keeps the form, reopens from Your saved drafts, and goes with the booking', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Client / Lead *').fill('Nina');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /Nina Fairbanks/ })
    .click();
  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
  await page
    .getByLabel('Internal Notes (not visible to client)')
    .fill('Fake: confirm the time first');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('schedule-note')).toContainText('Draft saved');

  // Listed under Your saved drafts; Continue opens it with every entry kept.
  const drafts = page.getByTestId('my-drafts');
  await drafts.getByRole('listitem').filter({ hasText: 'Follow-Up' }).getByRole('link').click();
  await expect(page).toHaveURL(/\/calendar\/new\?draft=[0-9a-f-]{36}/);
  await expect(page.getByLabel('Internal Notes (not visible to client)')).toHaveValue(
    'Fake: confirm the time first',
  );
  await expect(page.getByLabel('Appointment Type *').locator('option:checked')).toHaveText(
    'Follow-Up',
  );

  // It books like any form; the API deletes the draft with the booking (scheduling.e2e).
  await page.getByLabel('Date *').fill('2026-10-15');
  await page.getByLabel('Start Time *').selectOption('08:00');
  await page.getByLabel('End Time *').selectOption('08:30');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
});

test('Review 2 (B3): Back from an appointment returns to the same list filters and calendar view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  // The list: Last 30 days and a status; the address keeps them, and Back brings them back.
  await page.goto(app('/calendar/list'));
  const toolbar = page.getByTestId('appointments-toolbar');
  await expect(toolbar.getByLabel('Status')).toBeVisible({ timeout: 60_000 });
  await toolbar.getByLabel('Period').selectOption('next7');
  await toolbar.getByLabel('Status').selectOption('CONFIRMED');
  await toolbar.getByLabel('Search appointments').fill('a');
  await expect(page).toHaveURL(/status=CONFIRMED/);
  await expect(page).toHaveURL(/period=next7/);
  await page.goto(app('/calendar'));
  await page.goBack();
  await expect(toolbar.getByLabel('Period')).toHaveValue('next7', { timeout: 60_000 });
  await expect(toolbar.getByLabel('Status')).toHaveValue('CONFIRMED');
  await expect(toolbar.getByLabel('Search appointments')).toHaveValue('a');

  // The calendar: a month and its date stay in the address.
  await page.goto(app('/calendar?date=2026-10-01'));
  const calToolbar = page.getByTestId('appointments-toolbar');
  await expect(calToolbar.getByLabel('Show')).toBeVisible({ timeout: 60_000 });
  await calToolbar.getByLabel('Show').selectOption('month');
  await expect(page).toHaveURL(/view=month/);
  await expect(page.getByTestId('calendar-period')).toHaveText('October 2026');
  await page.goto(app('/calendar/list'));
  await page.goBack();
  await expect(page.getByTestId('calendar-period')).toHaveText('October 2026', { timeout: 60_000 });
  await expect(calToolbar.getByLabel('Show')).toHaveValue('month');
});
