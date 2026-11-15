import { expect, test } from '@playwright/test';

// R55, Appointments A3: Settings > Appointment Settings has the Waitlist card. On or off, and one
// of two clearly labelled, exclusive modes. Mock mode (mocks/appointment-waitlist.ts: on, in
// STAFF_APPROVAL) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the waitlist is switched and its one mode chosen, each kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/appointments'));
  const card = page.getByTestId('waitlist-card');
  const toggle = card.getByRole('switch', { name: 'Offer earlier openings' });
  await expect(toggle).toBeChecked({ timeout: 60_000 });
  const auto = card.getByRole('radio', { name: 'Automatic confirmation' });
  const staff = card.getByRole('radio', { name: 'Staff approval required' });
  await expect(staff).toBeChecked();
  await expect(auto).not.toBeChecked();
  const save = card.getByRole('button', { name: 'Save Waitlist' });
  await expect(save).toBeDisabled();

  // One mode at a time.
  await auto.check();
  await expect(staff).not.toBeChecked();
  await save.click();
  await expect(card.getByTestId('waitlist-saved')).toContainText(
    'Clients can join the waitlist from their portal.',
  );
  await expect(save).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('waitlist-card.png') });

  // Off: the mode stays as chosen and cannot change; nothing new is offered.
  await toggle.click();
  await expect(auto).toBeDisabled();
  await save.click();
  await expect(card.getByTestId('waitlist-saved')).toContainText('The waitlist is off');
  await expect(toggle).not.toBeChecked();
  await expect(auto).toBeChecked();
});
