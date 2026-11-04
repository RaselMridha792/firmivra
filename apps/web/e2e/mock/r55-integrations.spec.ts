import { expect, test } from '@playwright/test';

// R55, Octavia's Integrations review of Oct 28: Cancel and Back keep the list's search, filters,
// sort and view (IN-F02), one set of category names (IN-F03), and a Help icon per area (IN-F04).
// Mock mode, as the Owner; one 1440 px screenshot of the overview.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Overview: View details, then Cancel returns to the same search (IN-F02 A)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/integrations'));
  await page.getByLabel('Search integrations').fill('QuickBooks');
  await expect(page).toHaveURL(/search=QuickBooks/);
  await page.getByRole('button', { name: 'Actions for QuickBooks Online' }).click();
  await page.getByRole('menuitem', { name: 'View details' }).click();
  await expect(page).toHaveURL(/\/integrations\/[^/?]+\/connect\?from=/);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/integrations\?search=QuickBooks$/);
  await expect(page.getByLabel('Search integrations')).toHaveValue('QuickBooks');
});

test('Marketplace: browser Back keeps the search and view (IN-F02 B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/integrations/marketplace'));
  await page.getByLabel('Search integrations').fill('website');
  await expect(page).toHaveURL(/search=website/);
  await page.getByTestId('marketplace-integration').getByRole('link').first().click();
  await expect(page).toHaveURL(/from=/);
  await page.goBack();
  await expect(page.getByLabel('Search integrations')).toHaveValue('website');
});

test('one set of category names, and a Help icon per area (IN-F03, F04)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/integrations'));
  const categories = page.getByRole('combobox').filter({ hasText: 'CRM & Lead Generation' });
  await expect(categories).toHaveCount(1);
  await expect(page.getByText('Crm & Leads')).toHaveCount(0);
  for (const topic of [
    'Integrations overview',
    'Search, filters and Live or Test',
    'Integration health',
  ]) {
    await expect(page.getByRole('button', { name: `About ${topic}` })).toBeVisible();
  }
  const health = page.getByRole('button', { name: 'About Integration health' });
  await expect(health).toHaveAccessibleDescription(/nothing has been checked/);
  await health.focus();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/overview.png' });
});
