import { expect, test } from '@playwright/test';

// R60, Clients Review 2 gaps: a phone another client has opens Possible duplicate client (Create
// Anyway saves it; Keep Editing keeps the draft), and a non-US ZIP format is refused on Add.
// Mock mode (the clients mock: Jamie Sample has +1 404 555 0123). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a phone another client has asks first, then Create Anyway saves it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients?new=1'));
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Full name *').fill('Jamie Duplicate (fake)');
  await dialog.getByLabel('Email *').fill('jamie.duplicate@example.test');
  await dialog.getByLabel('Phone *').fill('(404) 555-0123');
  await dialog.getByLabel('Street address *').fill('1 Fake Way');
  await dialog.getByLabel('City *').fill('Atlanta');
  await dialog.getByLabel('State *').selectOption('GA');
  await dialog.getByLabel('ZIP code *').fill('abc');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog).toContainText('Enter a 5-digit ZIP code');
  await dialog.getByLabel('ZIP code *').fill('30301');
  await dialog.getByRole('button', { name: 'Add Client' }).click();

  const duplicate = page.getByRole('dialog', { name: 'Possible duplicate client' });
  await expect(duplicate).toBeVisible();
  await expect(duplicate.getByTestId('duplicate-matches')).toContainText('Jamie Sample');
  await expect(duplicate.getByRole('link', { name: /Open Existing/ })).toHaveAttribute(
    'target',
    '_blank',
  );
  await duplicate.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(dialog.getByLabel('Full name *')).toHaveValue('Jamie Duplicate (fake)');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await duplicate.getByRole('button', { name: 'Create Anyway' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Duplicate (fake)', {
    timeout: 60_000,
  });
});
