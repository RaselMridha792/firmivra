import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = `http://admin.localhost:${port}`;

test.use({ timezoneId: 'America/Los_Angeles' });

test('dashboard uses the firm applications mock and fits a 375 px screen', async ({ page }) => {
  await page.goto(`${admin}/`);

  await expect(page.getByRole('heading', { name: 'Welcome back, Morgan!' })).toBeVisible();
  await expect(page.getByTestId('stat-pending-applications-value')).toHaveText('4');
  await expect(page.getByTestId('stat-active-firms-value')).toHaveText('2');
  // No figure yet: a dash (and "Not available yet" for screen readers), never a made-up zero.
  await expect(page.getByTestId('stat-total-users-value')).toHaveText('— Not available yet');
  await expect(page.getByTestId('stat-monthly-revenue-value')).toHaveText('— Not available yet');

  const navigation = page.getByRole('navigation', { name: 'Main' });
  await expect(navigation.locator('a[href="/applications"]')).toContainText('4');
  await expect(page.getByTestId('recent-application')).toHaveCount(5);
  await expect(page.getByText('Sample Tax Partners LLC')).toBeVisible();
  const submittedTime = page.getByTestId('recent-application').first().locator('time');
  const submittedAt = await submittedTime.getAttribute('datetime');
  expect(submittedAt).not.toBeNull();
  const expectedSubmission = await page.evaluate((value) => {
    const date = new Date(value!);
    return {
      date: new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date),
      localTime: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
        date,
      ),
      utcTime: new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(date),
    };
  }, submittedAt);
  expect(expectedSubmission.localTime).not.toBe(expectedSubmission.utcTime);
  await expect(submittedTime).toContainText(expectedSubmission.date);
  await expect(submittedTime.locator('span.block.text-muted')).toHaveText(
    expectedSubmission.localTime,
  );
  await expect(page.getByTestId('system-status')).toContainText('Online');
  // Platform Growth draws new applications per day; firms and revenue have no history yet.
  await expect(page.getByTestId('platform-growth').getByRole('img')).toHaveCount(1);
  await expect(page.getByTestId('platform-growth')).toContainText('Active Firms');
  await expect(page.getByLabel('Range')).toHaveValue('30');
  const chart = page.getByTestId('platform-growth').getByRole('img');
  await expect(chart).toHaveAttribute('aria-label', /last 30 days: [1-9]\d* in total/);
  await page.getByLabel('Range').selectOption('7');
  await expect(chart).toHaveAttribute('aria-label', /last 7 days: \d+ in total/);
  await expect(
    page.getByRole('button', { name: 'Notifications' }).locator('.bg-danger'),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 812 });
  const pageWidth = await page.locator('body').evaluate((body) => body.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
