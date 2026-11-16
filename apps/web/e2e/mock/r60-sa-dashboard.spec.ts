// Super Admin batch 1 (R60): the dashboard's cards and rows open the lists they count, filtered
// the same way; the Firms tabs start on Active and live in the address; Application detail
// resends the owner's invitation. Mock data lives in the tab, so every step navigates in-app.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

/** Opens the dashboard and waits for its figures. */
async function dashboard(page: Page) {
  await page.goto(admin('/'));
  await expect(page.getByTestId('stat-pending-applications-value')).toHaveText('4');
}

test('SA-DSH-F02, SA-FRM-F01: Active Firms opens Firms on Active; the tab lives in the address', async ({
  page,
}) => {
  await dashboard(page);
  await page.getByTestId('stat-active-firms').getByRole('link', { name: 'View Firms' }).click();
  await expect(page).toHaveURL(admin('/firms?status=ACTIVE'));
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toHaveText(/^Active \(/);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.last()).toHaveText(/^All Firms \(/);

  await page.getByRole('tab', { name: /^All Firms \(/ }).click();
  await expect(page).toHaveURL(admin('/firms?status=ALL'));
  await page.getByRole('tab', { name: /^Inactive \(/ }).click();
  await expect(page).toHaveURL(admin('/firms?status=INACTIVE'));
  await expect(page.getByRole('row', { name: /Old Example Firm/ })).toBeVisible();

  // With nothing in the address, the list opens on Active.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Firms', exact: true })
    .click();
  await expect(page).toHaveURL(admin('/firms'));
  await expect(page.getByRole('tab', { name: /^Active \(/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
