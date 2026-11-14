import { expect, test } from '@playwright/test';

// R60, Clients Export (Octavia's E2 additions): Export shows its scope (the clients the list shows
// now, with its filters), the count and the columns (never an SSN, EIN or date of birth) before
// the CSV is made, then opens the file's link. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-clients-export';

test.describe.configure({ timeout: 180_000 });

test('Export previews its scope and count, then opens the CSV', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The list as the address keeps it: Business clients only.
  await page.goto(app('/clients?type=BUSINESS'));
  const names = page.getByTestId('clients-table').getByTestId('client-link');
  await expect(names.first()).toBeVisible({ timeout: 60_000 });
  const count = await names.count();

  await page.getByTestId('export-clients').click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toContainText(`the ${count} clients the list shows with its filters`);
  await expect(dialog).toContainText('Never an SSN, EIN or date of birth');
  await expect(dialog).toContainText('recorded in your firm');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/export.png` });

  // The link opens in a new tab; the browser won't open the mock's data link there, so the call
  // is recorded instead.
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url?: string | URL) => {
      w.opened.push(String(url));
      return null;
    };
  });
  await page.getByRole('button', { name: `Export ${count} clients` }).click();
  await expect(page.getByText(`Exported ${count} clients.`)).toBeVisible();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatch(/^data:text\/csv/);
  await expect(dialog).toBeHidden();
});
