import { expect, test } from '@playwright/test';

// Access & Security, Active Sessions tab (/team/[id]/security/sessions), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('lists every session with its rules and signs them all out', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/sessions`);
  await expect(page).toHaveTitle('Staff security: Active sessions');
  await expect(page.getByRole('link', { name: 'Active Sessions' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const sessions = page.getByTestId('active-sessions');
  await expect(sessions.getByRole('columnheader', { name: 'Signed In' })).toBeVisible();
  await expect(sessions).toContainText('MacBook Pro / Chrome');
  await expect(sessions).toContainText('iPhone / Safari');
  await expect(page.getByTestId('session-rules')).toContainText('30 minutes');

  await sessions.getByRole('button', { name: 'Sign Out All Sessions' }).click();
  await page
    .getByRole('dialog', { name: 'Sign Out All Sessions' })
    .getByRole('button', { name: 'Sign Out All' })
    .click();
  await expect(page.getByTestId('sessions-result')).toHaveText('2 sessions signed out.');
  await expect(sessions.getByText('No active sessions')).toBeVisible();
});

test('keeps its frames when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security/sessions`,
  );
  await expect(page.getByText('Sessions are not available')).toBeVisible();
  await expect(page.getByTestId('session-rules')).toBeVisible();
});
