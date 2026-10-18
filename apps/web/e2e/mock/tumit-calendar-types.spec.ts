import { expect, test } from '@playwright/test';

// Manage Appointment Types (/calendar/types), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. The types come from R12's mock. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('adds, archives and restores a type', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/types`);
  await expect(page).toHaveTitle('Appointment types');
  const list = page.getByTestId('types-list');
  await expect(list).toContainText('Tax consultation', { timeout: 60_000 });
  await expect(list).toContainText('Archived');

  await page.getByRole('button', { name: 'Add Type' }).click();
  const add = page.getByRole('dialog', { name: 'Add Appointment Type' });
  await add.getByRole('button', { name: 'Add Type' }).click();
  await expect(add.getByText('Enter a name.')).toBeVisible();
  await add.getByLabel('Name *').fill('Quarterly Review');
  await add.getByLabel('Length').selectOption('45');
  await add.getByRole('button', { name: 'Add Type' }).click();
  await expect(page.getByTestId('types-result')).toHaveText('Quarterly Review added.');
  await expect(list).toContainText('Quarterly Review');

  await list.getByRole('button', { name: 'Actions for Quarterly Review' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByTestId('types-result')).toContainText('archived');
  await list.getByRole('button', { name: 'Actions for Quarterly Review' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByTestId('types-result')).toHaveText('Quarterly Review is active again.');
});
