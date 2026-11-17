import { expect, test } from '@playwright/test';

// R55, Leads time zone (DECISIONS, Nov 16; Leads Review Two row 26): a lead's times are entered and
// shown in the firm's time zone and labelled with it. The mock firm is in New York; this device is
// in Chicago, an hour behind. Mock mode as the Owner; synthetic data.
test.use({ timezoneId: 'America/Chicago' });

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000001`;

test('a firm in New York and a device in Chicago: the follow-up shows and saves the firm’s time', async ({
  page,
}) => {
  // 8:15 AM in New York (7:15 AM here). Avery Lawson's call is seeded 30 hours ahead: Nov 17,
  // 2:15 PM in New York, which is 1:15 PM on this device.
  await page.clock.setFixedTime(new Date('2026-11-16T13:15:00.000Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lead);
  const card = page.getByTestId('card-follow-up');
  await expect(card).toContainText('Nov 17, 2026, 2:15 PM EST', { timeout: 60_000 });
  await expect(card).not.toContainText('1:15 PM');
  const date = card.getByLabel('Date', { exact: true });
  const time = card.getByRole('combobox', { name: 'Time (EST)' });
  await expect(date).toHaveValue('2026-11-17');
  await expect(time).toHaveValue('14:15');

  // Saved at 3:00 PM: that is 3:00 PM in New York, not on this device.
  await time.selectOption('15:00');
  await card.getByRole('button', { name: 'Save Follow-Up' }).click();
  await expect(card.getByRole('status')).toHaveText('Follow-up saved.');
  await expect(card).toContainText('Nov 17, 2026, 3:00 PM EST');
  await expect(card.getByRole('combobox', { name: 'Time (EST)' })).toHaveValue('15:00');

  // Scheduling an appointment names the firm's zone, not the raw zone id nor this device's.
  await page
    .getByRole('group', { name: 'Lead actions' })
    .getByRole('button', { name: 'Schedule Appointment' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Schedule Appointment' });
  await expect(dialog.getByLabel('Start (EST)')).toBeVisible({ timeout: 60_000 });
});
