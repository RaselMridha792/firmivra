import { expect, type Page, test } from '@playwright/test';

// Appointments Review 2 (A2, R56), in mock mode (playwright.mock.config.ts, signed in as the
// Owner): Settings > Appointment Settings' Rooms and Equipment, and the Equipment of Schedule
// Appointment. The mocks keep the API's rules (mocks/appointment-resources.ts): a room's name is
// its office's own, an item's is unique among live items, and an item holds one appointment at a
// time (409 naming it, never booked anyway).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** Moves inside the app without a reload, so the mock keeps what was booked. */
const go = (page: Page, href: string) =>
  page.evaluate((to) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(
      to,
    );
  }, href);

test('Owner adds, renames and archives a room for good; a name is its office’s own', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/appointments'));
  await expect(page.getByTestId('page-title')).toHaveText('Appointment Settings', {
    timeout: 60_000,
  });
  await expect(
    page.getByRole('navigation', { name: 'Settings' }).getByRole('link', {
      name: 'Appointment Settings',
    }),
  ).toHaveAttribute('aria-current', 'page');
  const rooms = page.getByTestId('rooms-card');
  await expect(rooms.getByTestId('room-name')).toHaveText([
    'Conference Room 1',
    'Conference Room 2',
  ]);
  await page.screenshot({ path: testInfo.outputPath('appointment-settings.png'), fullPage: true });

  // Add one at Riverside; the same name there again is refused, ignoring case.
  await rooms.getByTestId('new-room-office').selectOption({ label: 'Riverside Office' });
  await rooms.getByTestId('new-room-name').fill('Quiet Room');
  await rooms.getByRole('button', { name: 'Add Room' }).click();
  await expect(rooms.getByTestId('room-name')).toHaveText([
    'Conference Room 1',
    'Conference Room 2',
    'Quiet Room',
  ]);
  await rooms.getByTestId('new-room-name').fill('quiet room');
  await rooms.getByRole('button', { name: 'Add Room' }).click();
  await expect(rooms.getByRole('alert')).toHaveText('That name is already in use. Choose another.');

  // Rename.
  await rooms.getByRole('button', { name: 'Rename Quiet Room' }).click();
  await rooms.getByLabel('New name for Quiet Room').fill('Focus Room');
  await rooms.getByRole('button', { name: 'Save' }).click();
  await expect(rooms.getByTestId('room-name').last()).toHaveText('Focus Room');

  // Archive asks first and says it is final; then the room has no actions.
  await rooms.getByRole('button', { name: 'Archive Focus Room' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive Focus Room?' });
  await expect(dialog).toContainText('This is final');
  await dialog.getByRole('button', { name: 'Archive Room' }).click();
  await expect(dialog).toBeHidden();
  const archived = rooms.getByTestId('room-row').filter({ hasText: 'Focus Room' });
  await expect(archived).toContainText('Archived');
  await expect(archived.getByRole('button')).toHaveCount(0);

  // Schedule Appointment no longer offers it.
  await go(page, '/calendar/new');
  await expect(page.getByLabel('Office / Branch')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Office / Branch').selectOption({ label: 'Riverside Office' });
  await expect(page.getByLabel('Room (optional)').locator('option')).toHaveText(['No room']);
});

test('Owner adds, edits, archives and restores an item of equipment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/appointments'));
  const card = page.getByTestId('equipment-card');
  await expect(card.getByTestId('equipment-name')).toHaveText(
    ['Document scanner', 'Projector', 'Signature pad'],
    { timeout: 60_000 },
  );
  await expect(card.getByTestId('equipment-row').filter({ hasText: 'Projector' })).toContainText(
    'Main Office',
  );

  await card.getByTestId('new-item-name').fill('Laptop');
  await card.getByTestId('new-item-office').selectOption({ label: 'Main Office' });
  await card.getByTestId('new-item-description').fill('For screen sharing in person');
  await card.getByRole('button', { name: 'Add Equipment' }).click();
  const laptop = card.getByTestId('equipment-row').filter({ hasText: 'Laptop' });
  await expect(laptop).toContainText('Main Office');
  await expect(laptop).toContainText('For screen sharing in person');
  // A live item's name is its own, ignoring case.
  await card.getByTestId('new-item-name').fill('laptop');
  await card.getByRole('button', { name: 'Add Equipment' }).click();
  await expect(card.getByRole('alert')).toHaveText('That name is already in use. Choose another.');

  // Edit: any office.
  await laptop.getByRole('button', { name: 'Edit Laptop' }).click();
  const edit = card.getByRole('form', { name: 'Edit Laptop' });
  await edit.getByLabel('Office').selectOption({ label: 'Any office' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(laptop).toContainText('Any office');

  // Archive, then Restore.
  await laptop.getByRole('button', { name: 'Archive Laptop' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive Laptop?' });
  await expect(dialog).toContainText('You can restore it later');
  await dialog.getByRole('button', { name: 'Archive Equipment' }).click();
  await expect(laptop).toContainText('Archived');
  await laptop.getByRole('button', { name: 'Restore Laptop' }).click();
  await expect(laptop).not.toContainText('Archived');
});

test('Schedule Appointment books equipment that suits the place, and a held item is named', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  const fill = async () => {
    await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Client / Lead *').fill('Nina');
    await page
      .getByTestId('contact-results')
      .getByRole('button', { name: /Nina Fairbanks/ })
      .click();
    await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
    await page.getByLabel('Date *').fill('2026-10-15');
    await page.getByLabel('Start Time *').selectOption('08:00');
    await page.getByLabel('End Time *').selectOption('08:30');
    await page.getByLabel('Office / Branch').selectOption({ label: 'Main Office' });
  };
  const pick = page.getByTestId('equipment-pick');
  const choose = async (name: string) => {
    await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
    await pick.getByRole('group').getByLabel(name).check();
    await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
  };
  // A video meeting offers only the any-office pad (before a type, every method is open).
  const where = page.getByRole('radiogroup', { name: 'Location Type *' });
  await expect(where).toBeVisible({ timeout: 60_000 });
  await where.getByRole('radio', { name: 'Zoom / Video' }).click();
  await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
  await expect(pick.getByRole('group').locator('label')).toHaveText(['Signature pad']);
  await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
  await where.getByRole('radio', { name: 'In Person' }).click();
  await fill();
  // In person at the Main Office: its Projector and the any-office Signature pad, not Riverside's
  // scanner.
  await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
  await expect(pick.getByRole('group').locator('label')).toHaveText(['Projector', 'Signature pad']);
  await pick.getByRole('button', { name: /Equipment \(optional\)/ }).click();
  await choose('Signature pad');
  await expect(page.getByTestId('appointment-summary')).toContainText('Signature pad');
  await page.screenshot({ path: testInfo.outputPath('schedule-equipment.png'), fullPage: true });
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText('Signature pad')).toBeVisible({ timeout: 60_000 });

  // The same time with the same pad: refused, naming the pad, and never booked anyway.
  await go(page, '/calendar/new');
  await fill();
  await choose('Signature pad');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  const error = page.getByTestId('schedule-error');
  await expect(error).toContainText('Signature pad is already booked at this time.');
  await expect(page.getByLabel('Reason to book anyway (Owner or Admin)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Book Anyway' })).toHaveCount(0);
});

test('Appointment Settings fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/settings/appointments'));
  await expect(page.getByTestId('rooms-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('equipment-card')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
