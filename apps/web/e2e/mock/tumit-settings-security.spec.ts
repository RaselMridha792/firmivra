import { type Locator, expect, test } from '@playwright/test';

// Settings > Security & Access (/settings/security), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/settings/security`;

/** The value of one label and value row of a card. */
const fact = (card: Locator, label: string) =>
  card
    .locator('dl > div')
    .filter({ has: card.page().getByText(label, { exact: true }) })
    .locator('dd');

test('shows the sign-in rules, two-factor status and alerts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Security & access');
  const mfa = page.getByTestId('mfa-policy');
  await expect(fact(mfa, 'Active staff accounts')).toHaveText(/^\d+$/, { timeout: 60_000 });
  await expect(mfa).toContainText('Required');
  await expect(page.getByTestId('security-alerts')).toContainText('to review');
  await expect(page.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
    'href',
    '/integrations',
  );
});

// Octavia's review (Oct 20): the MFA card loads the firm's accounts (it said "Could not load this
// right now"), and never shows an unknown set-up count as a number.
test('the MFA card loads the firm accounts and says what is not recorded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const mfa = page.getByTestId('mfa-policy');
  await expect(fact(mfa, 'Active staff accounts')).toHaveText(/^\d+$/, { timeout: 60_000 });
  await expect(fact(mfa, 'Invited, not signed in yet')).toHaveText(/^\d+$/);
  await expect(fact(mfa, 'Method')).toHaveText('Authenticator app');
  await expect(fact(mfa, 'Staff with 2FA set up')).toHaveText('Not recorded yet');
  await expect(mfa).not.toContainText('Could not load');
  await expect(mfa.getByTestId('mfa-error')).toHaveCount(0);
  // Rasel (Oct 21): no "security admin" role; the Owner, or an Admin with Manage on Settings,
  // which Users & Roles shows as the Admin column.
  await expect(mfa).toContainText(
    'Only the Owner, or an Admin whose role has Admin access to Settings in Users & Roles, may change this requirement',
  );
  await expect(mfa).not.toContainText('security admin');
  await expect(mfa).toContainText('There is no setting to change it yet');
  await expect(mfa.getByRole('link', { name: 'Review Users' })).toHaveAttribute(
    'href',
    '/settings/users',
  );
});

// Her password, lockout and session rules, each card saying what applies today until the
// sign-in service applies them.
test('states the password, lockout and session rules and what is not in force yet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);

  const password = page.getByTestId('password-policy');
  await expect(fact(password, 'Minimum length')).toHaveText('15 characters', { timeout: 60_000 });
  // Rasel (Oct 21): spaces inside the password; Cognito refuses one at the start or end, and that
  // refusal stays (nothing trims). The lockout counts per account, on top of the network limit.
  await expect(fact(password, 'Spaces and symbols')).toHaveText(
    'Allowed; spaces inside the password, not at the start or end',
  );
  await expect(fact(password, 'Character mix')).toHaveText('Not required');
  await expect(fact(password, 'Compromised-password check')).toHaveText('On');
  await expect(fact(password, 'Lockout')).toHaveText(
    '5 failures on one account in 15 minutes lock it for 15 minutes',
  );
  await expect(password.locator('dl')).not.toContainText('12 characters');
  const passwordToday = password.getByTestId('password-not-in-force');
  await expect(passwordToday).toContainText('Not in force yet');
  await expect(passwordToday).toContainText('New passwords still need at least 12 characters');
  await expect(passwordToday).not.toContainText('space');
  // The account lockout is in force (#1008), so the note no longer names it.
  await expect(passwordToday).not.toContainText('lockout');

  const sessions = page.getByTestId('session-rules');
  await expect(fact(sessions, 'Longest sign-in')).toHaveText('8 hours, then sign in again');
  await expect(fact(sessions, 'Sign-out when idle')).toHaveText(
    'After 15 minutes, with a warning 2 minutes before',
  );
  await expect(fact(sessions, 'Deactivation or password reset')).toHaveText('Ends every session');
  await expect(sessions.locator('dl')).not.toContainText('7 days');
  const sessionsToday = sessions.getByTestId('sessions-not-in-force');
  await expect(sessionsToday).toContainText('Not in force yet');
  await expect(sessionsToday).toContainText('A sign-in still lasts up to 7 days');
  await expect(sessions.getByRole('link', { name: 'Open Staff Management' })).toHaveAttribute(
    'href',
    '/team',
  );
  await expect(page.getByRole('link', { name: 'Open Audit Log' })).toHaveAttribute(
    'href',
    '/audit-log',
  );
});

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(url);
  await expect(fact(page.getByTestId('mfa-policy'), 'Active staff accounts')).toHaveText(/^\d+$/, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
