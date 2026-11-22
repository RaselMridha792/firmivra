import { expect, test } from '@playwright/test';

// R1, Audit Log Review 2 R01 "consistently across the system": times outside the Audit Log are in
// the firm's time zone, with the zone named, whatever the computer's zone is. The mock firm is
// America/New_York; the browser is set to Tokyo, so a browser-zone time would read JST.
// Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.use({ timezoneId: 'Asia/Tokyo' });

test('R01: Automations and Business Advisory times are in the firm’s zone and name it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/automations/logs'));
  const eastern = /\d{1,2}:\d{2} (AM|PM) E[SD]T/;
  await expect(page.getByRole('table').first()).toContainText(eastern, { timeout: 60_000 });
  await expect(page.getByRole('table').first()).not.toContainText('JST');

  // The advisory clients' Next Meeting, a time of day: the firm's, named.
  await page.goto(app('/business-advisory/clients'));
  const clients = page.getByTestId('ba-clients');
  await expect(clients).toContainText(/\d{1,2}:\d{2} (AM|PM) E[SD]T/, { timeout: 60_000 });
  await expect(clients).not.toContainText('JST');
});
