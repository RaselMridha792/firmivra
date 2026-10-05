import { expect, test } from '@playwright/test';
import { getCountdown } from '../../../packages/ui/src/countdown';

const home = `http://localhost:${process.env['WEB_PORT'] ?? '3000'}`;

test('countdown separates days and rolls hours, minutes and seconds correctly', () => {
  expect(getCountdown(90061)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  expect(getCountdown(86400)).toEqual({ days: 1, hours: 0, minutes: 0, seconds: 0 });
  expect(getCountdown(60)).toEqual({ days: 0, hours: 0, minutes: 1, seconds: 0 });
  expect(getCountdown(-1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
});

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test(`${name}: minimal homepage loads without overflow or browser errors`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(home);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Firmivra | Coming Soon');
    await expect(page.getByRole('heading', { name: 'Coming soon.' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Firmivra', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Countdown to planned beta' })).toBeVisible();
    await expect(page.getByTestId('countdown-seconds')).toHaveText(/^\d{2}$/);
    await expect(page.getByText('January 8, 2027 (UTC)')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('countdown runs each second and stops at zero after the target', async ({ page }) => {
  const beforeBeta = new Date('2027-01-07T23:59:58Z');
  await page.clock.install({ time: beforeBeta });
  await page.clock.pauseAt(beforeBeta);
  await page.goto(home);
  await page.clock.runFor(1);
  await expect(page.getByTestId('countdown-seconds')).toHaveText('02');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('countdown-seconds')).toHaveText('01');
  await page.clock.runFor(2000);
  for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
    await expect(page.getByTestId(`countdown-${unit}`)).toHaveText('00');
  }
  await expect(page.getByText('Final preparations underway', { exact: false })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.getByTestId('countdown-seconds')).toHaveText('00');
});
