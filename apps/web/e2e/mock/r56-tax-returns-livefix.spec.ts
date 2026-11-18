import { expect, test } from '@playwright/test';

// R56: the Tax Returns rows R61's live check failed on dev (F25-J, F36, ACC-DOC, F08-S), in mock
// mode as an Owner. The mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('F36: "Where returns appear" shows for a firm with no tax statuses too', async ({ page }) => {
  await page.goto(app('/settings/tax-statuses'));
  await expect(page.getByTestId('where-returns-appear')).toBeVisible({ timeout: 60_000 });
  // Archive every status: the firm has none left.
  const archive = page.getByRole('button', { name: /^Archive / });
  for (let n = await archive.count(); n > 0; n--) {
    await archive.first().click();
    await expect(archive).toHaveCount(n - 1);
  }
  await expect(page.getByText('No tax statuses yet')).toBeVisible();
  const where = page.getByTestId('where-returns-appear');
  await expect(where).toBeVisible();
  await expect(where).toContainText('Where returns appear');
});
