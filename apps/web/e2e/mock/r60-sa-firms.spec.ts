// Super Admin Firms (R60, Nov 19): the firm page's Actions menu (Suspend, Reactivate, Close, each
// with a required reason) and its Account History; exact Suspended and Closed badges; the firms
// list's plan filter and sortable columns, kept in the address so Back from a firm restores it.
// Mock mode. Mock data lives in the tab, so every step after the first navigates in-app.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
/** The mock's Active firm that came from an application (mocks/firm-applications.ts, n 5). */
const NORTHSIDE = {
  id: '0199b6a3-0000-7000-8000-000000000005',
  name: 'Example Northside Accounting LLC',
};

async function act(page: Page, item: string, reason: string) {
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (required)').fill(reason);
  await dialog.getByRole('button', { name: item }).click();
  await expect(dialog).toBeHidden();
}

test('SA-FRM-F02, F04, Y10: Suspend asks for a reason, Cancel changes nothing, Reactivate restores', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin(`/firms/${NORTHSIDE.id}`));
  const status = page.getByTestId('application-status');
  await expect(status).toHaveText('Active', { timeout: 60_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: /^Reactivate Account/ })).toBeDisabled();
  await page.getByRole('menuitem', { name: /^Suspend Account/ }).click();
  const dialog = page.getByRole('dialog', { name: `Suspend ${NORTHSIDE.name}?` });
  await expect(dialog).toContainText(`${NORTHSIDE.name}'s staff and clients can't use`);
  await dialog.getByRole('button', { name: 'Suspend Account' }).click();
  await expect(dialog.getByLabel('Reason (required)')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Enter the reason.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(status).toHaveText('Active');

  await act(page, 'Suspend Account', 'Fake: three invoices unpaid');
  await expect(status).toHaveText('Suspended');
  await expect(page.getByTestId('firm-action-done')).toHaveText(`${NORTHSIDE.name} is suspended.`);
  const latest = page.getByTestId('firm-account-event').first();
  await expect(latest).toContainText('Suspended');
  await expect(latest).toContainText('By Morgan Admin');
  await expect(latest).toContainText('Reason: Fake: three invoices unpaid');
  await expect(page.getByText('After setup')).toHaveCount(0);

  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: /^Suspend Account/ })).toContainText(
    'This firm is already suspended',
  );
  await page.keyboard.press('Escape');
  await act(page, 'Reactivate Account', 'Fake: paid in full');
  await expect(status).toHaveText('Active');
  await expect(page.getByTestId('firm-account-event')).toHaveText([
    /^Reactivated/,
    /^Suspended/,
    /^Activated/,
  ]);
});

test('SA-FRM-F03, Y06: Close is final; a closed firm says Closed, never "After setup"', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin(`/firms/${NORTHSIDE.id}`));
  await expect(page.getByTestId('application-status')).toHaveText('Active', { timeout: 60_000 });
  await act(page, 'Close Account', 'Fake: the owner asked to close');
  await expect(page.getByTestId('application-status')).toHaveText('Closed');
  await expect(page.getByTestId('firm-account-event').first()).toContainText('Closed');
  await expect(page.getByText('After setup')).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions' }).click();
  for (const item of ['Suspend Account', 'Reactivate Account', 'Close Account']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(`^${item}`) })).toContainText(
      'This firm is closed',
    );
  }
});

test('SA-FRM-Y06, Y07: the Inactive tab shows each firm’s own status; an older closure is in its history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/firms?status=INACTIVE'));
  const row = (name: string) => page.getByRole('row', { name: new RegExp(name) });
  await expect(row('Old Example Firm')).toContainText('Suspended', { timeout: 60_000 });
  await expect(row('Lakeside Closed Example')).toContainText('Closed');
  await expect(page.locator('table tbody')).not.toContainText('Inactive');
  await page.getByRole('link', { name: 'Open firm Lakeside Closed Example' }).click();
  await expect(page.getByTestId('firm-status')).toHaveText('Closed');
  const history = page.getByTestId('firm-account-event');
  await expect(history.first()).toContainText('Closed');
  await expect(history.first()).toContainText('Recorded by the platform');
});

test('SA-FRM-Y05, Y08: plan, sort and tab live in the address, and Back from a firm restores them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/firms'));
  await page.getByRole('tab', { name: /^All Firms \(/ }).click({ timeout: 60_000 });
  const first = page.locator('table tbody tr').first();

  await page.getByRole('button', { name: 'Business Name' }).click();
  await expect(page).toHaveURL(admin('/firms?status=ALL&sort=name'));
  await expect(first).toContainText('Example Northside Accounting LLC');
  await expect(page.getByRole('columnheader', { name: 'Business Name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('button', { name: 'Business Name' }).click();
  await expect(page).toHaveURL(admin('/firms?status=ALL&sort=name&order=desc'));
  await expect(first).toContainText('Sample Riverside Tax Co');

  await page.getByLabel('Plan', { exact: true }).selectOption({ label: 'Starter' });
  await expect(page.getByTestId('firms-empty')).toBeVisible();
  await page.getByLabel('Plan', { exact: true }).selectOption({ label: 'Professional' });
  await expect(page).toHaveURL(admin('/firms?status=ALL&sort=name&order=desc&plan=PROFESSIONAL'));
  await expect(page.locator('table tbody tr')).toHaveCount(2);
  await expect(first).toContainText('Sample Riverside Tax Co');

  await page.getByRole('link', { name: 'Open firm Example Northside Accounting LLC' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Example Northside Accounting LLC');
  await page.getByRole('link', { name: 'Back to Firms' }).click();
  await expect(page).toHaveURL(admin('/firms?status=ALL&sort=name&order=desc&plan=PROFESSIONAL'));
  await expect(page.getByLabel('Plan', { exact: true })).toHaveValue('PROFESSIONAL');
  await expect(page.getByRole('tab', { name: /^All Firms \(/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(first).toContainText('Sample Riverside Tax Co');
});
