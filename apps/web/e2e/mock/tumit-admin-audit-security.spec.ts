import { expect, test } from '@playwright/test';

// Super Admin Audit & Security (S02) in mock mode: playwright.mock.config.ts runs
// NEXT_PUBLIC_API_MOCK=all, which signs the console in as Morgan Admin and serves
// mocks/admin-audit-security.ts. Each test opens its page fresh, so the mock starts from its seed.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
// Marcus Bell's third failed login, which locked his account (admin-audit-security-data.ts, n 2).
const LOCKED_LOGIN = '0199d1a0-0e01-7000-8000-000000000002';

test('the dashboard shows its cards and log, and the filters and tabs narrow it', async ({
  page,
}) => {
  await page.goto(admin('/audit-security'));
  await expect(page.getByRole('heading', { level: 1, name: 'Audit & Security' })).toBeVisible();
  for (const card of ['securityAlerts', 'failedLogins', 'activeSessions', 'highRiskEvents'])
    await expect(page.getByTestId(`kpi-${card}-value`)).toHaveText(/^\d+$/);
  const events = page.getByTestId('audit-events');
  await expect(events.getByRole('link', { name: /^View event EVT-/ }).first()).toBeVisible();
  await expect(page.getByText(/^Showing 1 – 8 of \d+ logs$/)).toBeVisible();

  await page.getByRole('combobox', { name: 'Severity' }).selectOption('HIGH');
  await expect(page).toHaveURL(/severity=HIGH/);
  await expect(events.getByText('Marcus Bell').first()).toBeVisible();
  await expect(events.locator('tbody tr').filter({ hasText: 'Login Success' })).toHaveCount(0);
  await expect(events.locator('tbody tr').filter({ hasNotText: 'High' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await page.getByRole('tab', { name: 'Login History' }).click();
  await expect(page.getByTestId('view-intro')).toContainText('Login History');
  await expect(page).toHaveURL(/view=login/);
  await page.getByRole('searchbox', { name: 'Search events' }).fill('Marcus');
  await expect(events.locator('tbody tr').filter({ hasNotText: 'Marcus Bell' })).toHaveCount(0);

  await events
    .getByRole('link', { name: /^View event EVT-/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/audit-security\/events\/0199d1a0-0e01-/);
  await expect(page.getByTestId('event-title')).toContainText('Login Failed');
});

test('Export Logs downloads the filtered rows and logs the export', async ({ page }) => {
  await page.goto(admin('/audit-security'));
  await expect(
    page
      .getByTestId('audit-events')
      .getByRole('link', { name: /^View event EVT-/ })
      .first(),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Logs' }).click();
  await page.getByRole('menuitem', { name: 'Export as CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^firmivra-audit-events-\d{8}\.csv$/);
  await expect(page.getByText(/The export was added to the audit log\./)).toBeVisible();
  await expect(page.getByTestId('audit-events')).toContainText('Exported Audit Logs');
});

test('an event shows its record, and Unlock Account writes a linked event', async ({ page }) => {
  await page.goto(admin(`/audit-security/events/${LOCKED_LOGIN}`));
  await expect(page.getByRole('heading', { level: 1, name: 'Event Details' })).toBeVisible();
  await expect(page.getByTestId('event-title')).toHaveText('Login Failed');
  await expect(page.getByTestId('event-information')).toContainText('Marcus Bell');
  await expect(page.getByTestId('event-information')).toContainText('Locked');
  await expect(page.getByTestId('risk-indicators')).toContainText('Multiple failed login attempts');
  await expect(page.getByTestId('quick-info')).toContainText('View 4 related events');

  await page.getByRole('tab', { name: 'Related Events' }).click();
  await expect(page.getByTestId('related-events')).toContainText('Login Failed (1st attempt)');

  await page.getByRole('button', { name: 'Unlock Account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock Account' });
  await dialog.getByLabel('Reason (optional)').fill('Verified with the user by phone.');
  await dialog.getByRole('button', { name: 'Unlock Account' }).click();
  await expect(page.getByText(/Unlock Account: done\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock Account' })).toBeDisabled();
  await expect(page.getByTestId('event-information')).toContainText('Active');

  await page.getByRole('tab', { name: 'Actions Taken' }).click();
  await expect(page.getByTestId('actions-taken')).toContainText('Verified with the user by phone.');
  await page
    .getByLabel('Add an investigation note')
    .fill('Called the user; the attempts were theirs.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(page.getByTestId('investigation-notes')).toContainText('the attempts were theirs');
});

test('security settings save after a review, are audited, and catch a bad length', async ({
  page,
}) => {
  await page.goto(admin('/audit-security/settings'));
  await expect(page.getByRole('heading', { level: 1, name: 'Security Settings' })).toBeVisible();
  const length = page.getByLabel('Minimum Length');
  await expect(length).toHaveValue('12');

  await length.fill('6');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(length).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a whole number from 8 to 128.')).toBeVisible();

  await length.fill('14');
  await page.getByRole('combobox', { name: 'Lockout Duration' }).selectOption('15');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review changes' });
  await expect(dialog.getByTestId('settings-changes')).toContainText(
    '12 characters → 14 characters',
  );
  await expect(dialog.getByTestId('settings-changes')).toContainText('Lockout duration');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('settings-status')).toHaveText(/^Security settings saved\./);
  await expect(length).toHaveValue('14');

  // The save is in the audit log, on the Security Policies tab.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Audit & Security' })
    .click();
  await page.getByRole('tab', { name: 'Security Policies' }).click();
  await expect(page.getByTestId('audit-events')).toContainText('Updated Security Settings');
});

for (const [name, path, ready] of [
  ['the dashboard', '/audit-security', 'kpi-securityAlerts-value'],
  ['an event', `/audit-security/events/${LOCKED_LOGIN}`, 'event-title'],
  ['security settings', '/audit-security/settings', 'settings-password-policy'],
] as const) {
  test(`${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByTestId(ready)).toBeVisible();
    // Loaded: no skeleton is left, and nothing failed.
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
    await expect(page.getByText(/Could not load this right now/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
