import { expect, test } from '@playwright/test';

// Edit Existing (/calendar/[id]/edit), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The scheduling mock's second appointment is Nina Fairbanks's. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const NINA = '0199c0b0-0a10-7000-8000-000000000002';

test('fills the form from the appointment and saves a change', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/calendar/${NINA}/edit`);
  await expect(page).toHaveTitle('Edit appointment');
  await expect(page.getByLabel('Client / Lead *')).toHaveValue('Nina Fairbanks', {
    timeout: 60_000,
  });
  await expect(page.getByRole('link', { name: 'Edit Existing' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // An existing appointment keeps its contact: no new contact here, and no draft.
  await expect(page.getByRole('button', { name: 'Add a new contact' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as Draft' })).toHaveCount(0);

  await page.getByLabel('Client Instructions (visible to client)').fill('Bring your W-2 forms.');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
});

test('explains an appointment that is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/calendar/0199c0b0-0a10-7000-8000-000000000999/edit`,
  );
  await expect(page.getByTestId('edit-unavailable')).toContainText('was not found', {
    timeout: 60_000,
  });
});
