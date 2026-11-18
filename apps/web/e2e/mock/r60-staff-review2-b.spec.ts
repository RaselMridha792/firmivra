// R60, Staff Management Review 2, second batch (Nov 17 review; the lead's decisions of Nov 18).
// Mock mode, as an Owner. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('SM15: department and team counts name both the active and the assigned staff', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/departments'));
  const named = (testId: string, name: string) =>
    page.getByTestId(testId).filter({ hasText: new RegExp(`^${name}$`) });
  const row = (testId: string, name: string) =>
    page.getByRole('row').filter({ has: named(testId, name) });
  // Tax: two active, one locked and one invited; the deactivated never count.
  await expect(row('department-row', 'Tax')).toContainText('2 active · 4 assigned', {
    timeout: 60_000,
  });
  await expect(page.getByRole('columnheader', { name: 'Staff', exact: true })).toBeVisible();
  await expect(row('department-row', 'Marketing')).toContainText('0 active · 0 assigned');
  await named('department-row', 'Tax').click();
  await expect(page.getByTestId('department-details')).toContainText('2 active · 4 assigned');

  await page.getByRole('link', { name: 'Teams', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByTestId('team-row') })
      .first(),
  ).toContainText(/\d+ active · \d+ assigned/);
});

test('SM08: assigning a client past someone’s maximum warns, and still assigns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  // The team mock: Sam Staff carries 2 active clients, their maximum.
  const row = page
    .locator('[data-testid="client-card"], [data-testid="clients-table"] tbody tr')
    .filter({ visible: true })
    .filter({ hasText: 'Riley Example' });
  await row.getByRole('checkbox').check({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: 'Assign Staff Member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Staff Member' });
  await dialog.getByLabel('Assign to').selectOption({ label: 'Adam Admin' });
  await expect(dialog.getByTestId('workload-warning')).toHaveCount(0);
  await dialog.getByLabel('Assign to').selectOption({ label: 'Sam Staff' });
  await expect(dialog.getByTestId('workload-warning')).toHaveText(
    'Sam Staff would have 3 active clients, over their maximum of 2. You can still assign them.',
  );
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText('1 client updated.')).toBeVisible();
});

test('SM12: Active Sessions marks this session on your own record only', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The mock signs in as its first member, Morgan Avery (the Owner).
  await page.goto(app('/team/0199c0a0-0a00-7000-8000-000000000001/security/sessions'));
  const sessions = page.getByTestId('active-sessions');
  await expect(sessions).toContainText('MacBook Pro / Chrome', { timeout: 60_000 });
  await expect(sessions.getByText('This session', { exact: true })).toHaveCount(1);
  await page.goto(app('/team/0199c0a0-0a00-7000-8000-000000000006/security/sessions'));
  await expect(sessions).toContainText('MacBook Pro / Chrome', { timeout: 60_000 });
  await expect(sessions.getByText('This session', { exact: true })).toHaveCount(0);
});

test('SM05: Apply to Existing Accounts previews who changes, keeps the exceptions, and applies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/settings/security'));
  await page.getByRole('button', { name: 'Apply to Existing Accounts' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Apply to existing accounts?' });
  const rows = dialog.getByTestId('apply-account');
  await expect(rows.filter({ hasText: 'Hana Kim' })).toContainText('Changes:');
  // Yourself is left out, and says where to change your own; the deactivated are not listed.
  await expect(dialog).toContainText('Morgan Avery: you');
  await expect(dialog).not.toContainText('Victor Lane');
  await rows.filter({ hasText: 'Hana Kim' }).getByRole('checkbox').uncheck();
  await dialog.getByRole('button', { name: /^Apply to \d+ Accounts?$/ }).click();
  await expect(page.getByTestId('apply-result')).toHaveText(
    /^Applied to \d+ accounts?\. 1 account kept their own\.$/,
  );
  // Looked at again: only the exception still differs.
  await page.getByRole('button', { name: 'Apply to Existing Accounts' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Hana Kim');
});

test('SM17: pay is never saved in a draft, and stays on the page through Back and Next', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  await page.getByLabel('First Name *').fill('Ada', { timeout: 60_000 });
  await page.getByLabel('Last Name *').fill('Moss');
  await page.getByLabel('Work Email *').fill('ada.moss.sm17@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await page.getByRole('button', { name: 'Next: Access & Security' }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click({ timeout: 30_000 });
  await page.getByLabel('Pay Rate / Salary').fill('52.50', { timeout: 30_000 });
  await expect(page.getByText('Never saved in a draft.')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
  await expect(page.getByLabel('Pay Rate / Salary')).toHaveValue('52.50');
});

// SM40: keyboard, focus and narrow screens on Staff Management.
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('SM40: a dialog gives focus back to the button that opened it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/team/${HANA}/security/sessions`));
  const open = page
    .getByTestId('active-sessions')
    .getByRole('button', { name: 'Sign Out All Sessions' });
  await open.click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Sign Out All Sessions' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test('SM40: Create Staff goes field to field with Tab, and a missing field is announced', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  const first = page.getByLabel('First Name *');
  await first.focus({ timeout: 60_000 });
  for (const next of ['Last Name *', 'Work Email *', 'Phone Number (Optional)']) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(next)).toBeFocused();
  }
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  const described = await first.getAttribute('aria-describedby');
  expect(described).toBeTruthy();
  await expect(page.locator(`[id="${described?.split(' ')[0]}"]`)).not.toBeEmpty();
});

for (const width of [768, 375])
  test(`SM40: Staff Management fits a ${width} px screen with no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/team', '/team/new', `/team/${HANA}`, '/team/settings/security']) {
      await page.goto(app(path));
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
        timeout: 60_000,
      });
      const [scroll, inner] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ]);
      expect(scroll, `${path} at ${width} px`).toBeLessThanOrEqual(inner);
    }
  });
