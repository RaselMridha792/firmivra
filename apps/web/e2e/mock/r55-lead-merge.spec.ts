import { expect, type Page, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 15: duplicate review from the Leads list, then Compare
// and Merge on purpose (never automatic), or "Not a Duplicate". In mock mode
// (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

/** A second lead with Bruno Sandoval's email, created anyway after the duplicate warning. */
async function addTwin(page: Page, first: string) {
  await page.goto(`${app}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(first);
  await dialog.getByLabel('Last name').fill('Fakeperson');
  await dialog.getByRole('textbox', { name: 'Email' }).fill('bruno.sandoval@example.test');
  await dialog.getByLabel('Assigned staff').selectOption({ label: 'Hana Kim' });
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await dialog
    .getByLabel('Create this lead anyway if the matching email or phone is correct')
    .check();
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);
}

const pairWith = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Possible duplicates' })
    .getByRole('listitem')
    .filter({ hasText: name });

test('merges a duplicate on purpose, keeping the chosen values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await addTwin(page, 'Twin');
  await page.getByTestId('review-duplicates').click();
  await expect(page).toHaveURL(/\/leads\/duplicates$/);
  const pair = pairWith(page, 'Twin Fakeperson');
  await expect(pair).toContainText('Same email');
  await expect(pair).toContainText('Bruno Sandoval');
  await pair.getByRole('link', { name: 'Compare and Merge' }).click();

  const merge = page.getByTestId('lead-merge');
  await merge.getByRole('radio', { name: /Keep Bruno Sandoval/ }).check();
  // The name differs: keep the twin's first name on Bruno's lead.
  await merge
    .getByTestId('merge-name')
    .getByRole('radio', { name: /Twin Fakeperson/ })
    .check();
  await expect(merge).toContainText('Twin Fakeperson');
  await merge.getByTestId('merge-start').click();
  const confirm = page.getByRole('dialog', { name: 'Merge these leads?' });
  await confirm.getByRole('button', { name: 'Merge' }).click();

  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('lead-merged-from')).toContainText('Twin Fakeperson');
  await expect(page.getByTestId('card-contact')).toContainText('Twin Fakeperson');
  // The merged lead opens, read only, linked back.
  await page.getByTestId('lead-merged-from').getByRole('link').first().click();
  await expect(page.getByTestId('lead-merged-into')).toContainText('merged into');
});

test('Not a Duplicate takes the pair off the review', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await addTwin(page, 'Other');
  // In the same page: the mock keeps the new lead in memory until a reload.
  await page.getByTestId('review-duplicates').click();
  const pair = pairWith(page, 'Other Fakeperson');
  await expect(pair).toBeVisible();
  await pair.getByRole('button', { name: 'Not a Duplicate' }).click();
  await expect(pair).toHaveCount(0);
});
