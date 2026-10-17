import { expect, test } from '@playwright/test';

// Staff Management > Activity & Login History (/team/activity), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The audit mock has a few synthetic rows.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the team activity and filters by member', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/activity`);
  await expect(page).toHaveTitle('Activity & login history');
  await expect(page.getByTestId('page-title')).toHaveText('Activity & Login History');
  const activity = page.getByTestId('team-activity');
  await expect(activity).toContainText('Appointment rescheduled');
  // A client's sign-in is not the team's.
  await expect(page.getByTestId('team-login-history')).not.toContainText('Jamie Sample');

  await page.getByLabel('Staff member').selectOption({ label: 'Priya Ramos' });
  await expect(activity.getByText('No activity')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Full Audit Log' })).toHaveAttribute(
    'href',
    '/audit-log',
  );
});
