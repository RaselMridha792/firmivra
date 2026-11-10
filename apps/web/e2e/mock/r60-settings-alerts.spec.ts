import { expect, test } from '@playwright/test';

// R60, Octavia's Overview guide of Oct 18, items 6 and 19 (docs/specs/settings-review-2026-10-20/
// overview--*.md): the Overview's View Alerts opens Security & Access on its open alerts (never
// Notifications), and open alerts put a badge on Settings in the main menu that opens the same.
// Mock mode as the Owner: one open alert, a client portal lockout. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-settings-alerts';

test.describe.configure({ timeout: 180_000 });

test('View Alerts and the Settings badge open the open alerts on Security & Access', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/overview'));
  const kpi = page.getByTestId('kpi-security-alerts');
  await expect(kpi).toContainText('Security Alerts1', { timeout: 60_000 });
  await expect(kpi).toContainText('Requires review');

  // The badge on Settings is a link of its own, to the alerts.
  const badge = page.getByTestId('nav-badge-link');
  await expect(badge).toHaveText('1');
  await expect(badge).toHaveAccessibleName('1 security alert to review');
  await expect(badge).toHaveAttribute('href', '/settings/security?alerts=open');
  await page.mouse.move(700, 5);
  await page.screenshot({ path: `${shots}/overview.png` });

  await kpi.getByRole('link', { name: 'View Alerts' }).click();
  await expect(page).toHaveURL(/\/settings\/security\?alerts=open$/, { timeout: 60_000 });
  const card = page.getByTestId('security-alerts');
  await expect(card).toContainText('1 to review');
  await expect(card.getByTestId('open-alerts')).toContainText(
    'Account locked after repeated failed sign-ins',
  );
  await expect(card.getByTestId('open-alerts')).toContainText('Client portal · locked until');
  // Only the open alerts: the 30-day failed sign-ins wait behind a link.
  await expect(card.getByRole('heading', { name: 'Failed sign-ins', exact: true })).toHaveCount(0);
  await page.mouse.move(700, 5);
  await page.screenshot({ path: `${shots}/alerts.png` });
  await card.getByRole('link', { name: 'Show failed sign-ins too' }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(card.getByRole('heading', { name: 'Failed sign-ins', exact: true })).toBeVisible();

  // From anywhere in the workspace, the badge opens the same.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks/, { timeout: 60_000 });
  await page.getByTestId('nav-badge-link').click();
  await expect(page).toHaveURL(/\/settings\/security\?alerts=open$/, { timeout: 60_000 });
  await expect(page.getByTestId('open-alerts')).toBeVisible();
});
