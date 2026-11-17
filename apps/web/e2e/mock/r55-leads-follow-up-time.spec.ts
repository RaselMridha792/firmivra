import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 5: the follow-up editor opens on the saved date and time (never the
// 10:00 AM default), and saving it unchanged keeps that time. The clock is set so the mock's
// first lead has its call due at 2:15 PM tomorrow, a time between the half hours. Mock mode as the
// Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = (n: number) =>
  `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-${String(n).padStart(12, '0')}`;

test('R2 5: the follow-up editor opens on the saved time, and an unchanged save keeps it', async ({
  page,
}) => {
  // 8:15 AM in New York, the firm's zone, where a lead's times are shown (Leads time zone,
  // DECISIONS Nov 16). Avery Lawson's call is seeded 30 hours ahead: Nov 17, 2026, 2:15 PM EST.
  await page.clock.setFixedTime(new Date('2026-11-16T13:15:00.000Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(lead(1));
  const card = page.getByTestId('card-follow-up');
  await expect(page.getByTestId('card-recent-activity')).not.toContainText('Follow-up scheduled');
  await expect(card).toContainText('Nov 17, 2026, 2:15 PM');
  const date = card.getByLabel('Date', { exact: true });
  const time = card.getByRole('combobox', { name: 'Time' });
  await expect(date).toHaveValue('2026-11-17');
  await expect(time).toHaveValue('14:15');
  await expect(time.locator('option:checked')).toHaveText('2:15 PM');

  await card.getByRole('button', { name: 'Save Follow-Up' }).click();
  // Saved (the lead's activity says so; the card then reopens on the saved lead), and the card
  // says so too: the notice outlives the card's remount on the saved lead.
  await expect(page.getByTestId('card-recent-activity')).toContainText('Follow-up scheduled');
  await expect(card.getByRole('status')).toHaveText('Follow-up saved.');
  await expect(card).toContainText('Nov 17, 2026, 2:15 PM');
  await expect(time).toHaveValue('14:15');

  // Away and back: the editor opens on the saved time again.
  const tabs = page.getByRole('navigation', { name: 'Lead profile' });
  await tabs.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(card).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Overview' }).click();
  await expect(date).toHaveValue('2026-11-17');
  await expect(time).toHaveValue('14:15');
});
