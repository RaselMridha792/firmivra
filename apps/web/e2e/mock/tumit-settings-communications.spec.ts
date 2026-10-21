import { expect, test } from '@playwright/test';

// Settings > Communications (/settings/communications), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('previews and saves the sender identity and email content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/communications`);
  await expect(page).toHaveTitle('Communications settings');
  await expect(page.getByLabel('From Name')).toBeVisible({ timeout: 60_000 });

  await page.getByLabel('Reply-To Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter a valid email, or leave it empty.')).toBeVisible();

  await page.getByLabel('From Name').fill('LVP Client Team');
  await page.getByLabel('Reply-To Email').fill('office@example.test');
  await page.getByLabel('Footer').fill('LVP Accounting & Taxes, Springfield');
  const preview = page.getByTestId('email-preview');
  await expect(preview).toContainText('LVP Client Team');
  await expect(preview).toContainText('office@example.test');
  await expect(preview).toContainText('LVP Accounting & Taxes, Springfield');

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('communications-saved')).toHaveText(
    'Communication settings saved.',
  );
  await expect(page.getByLabel('From Name')).toHaveValue('LVP Client Team');
});

// Octavia's review (Oct 20): Text Messages > Open Communications gave "Page not found". It opens
// the main Communications module (/communications, the sidebar's item), asking first when there
// are unsaved edits: Save and Leave, Discard and Leave, or Stay.
const settings = `http://app.localhost:${port}/settings/communications`;
const moduleUrl = `http://app.localhost:${port}/communications`;

test('Open Communications opens the Communications module, and back returns here', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(settings);
  const open = page.getByTestId('sms-settings').getByRole('link', { name: 'Open Communications' });
  await expect(open).toHaveAttribute('href', '/communications', { timeout: 60_000 });

  await open.click();
  await expect(page).toHaveURL(moduleUrl);
  await expect(page.getByTestId('quick-cards')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Page not found')).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(settings);
  await expect(page.getByLabel('From Name')).toBeVisible();
});

test('Open Communications with unsaved edits asks: Stay, Save and Leave, Discard and Leave', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(settings);
  const fromName = page.getByLabel('From Name');
  await expect(fromName).toBeVisible({ timeout: 60_000 });
  const open = page.getByTestId('sms-settings').getByRole('link', { name: 'Open Communications' });
  const prompt = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });

  // Stay keeps the page and the draft.
  await fromName.fill('LVP Client Team');
  await open.click();
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Save and Leave' })).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Discard and Leave' })).toBeVisible();
  await prompt.getByRole('button', { name: 'Stay' }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(settings);
  await expect(fromName).toHaveValue('LVP Client Team');

  // A save that fails its check stays here with the draft and the field error.
  await page.getByLabel('Reply-To Email').fill('not-an-email');
  await open.click();
  await prompt.getByRole('button', { name: 'Save and Leave' }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(settings);
  await expect(page.getByText('Enter a valid email, or leave it empty.')).toBeVisible();
  await expect(fromName).toHaveValue('LVP Client Team');

  // Save and Leave saves, then opens Communications; the saved name is there on the way back.
  await page.getByLabel('Reply-To Email').fill('office@example.test');
  await open.click();
  await prompt.getByRole('button', { name: 'Save and Leave' }).click();
  await expect(page).toHaveURL(moduleUrl);
  await expect(page.getByTestId('quick-cards')).toBeVisible({ timeout: 60_000 });
  await page.goBack();
  await expect(page).toHaveURL(settings);
  await expect(fromName).toHaveValue('LVP Client Team');
  await expect(page.getByLabel('Reply-To Email')).toHaveValue('office@example.test');

  // Discard and Leave opens Communications without saving the draft.
  await page.getByLabel('Footer').fill('A footer that is never saved');
  await open.click();
  await prompt.getByRole('button', { name: 'Discard and Leave' }).click();
  await expect(page).toHaveURL(moduleUrl);
  await page.goBack();
  await expect(page).toHaveURL(settings);
  await expect(page.getByLabel('Footer')).toHaveValue('100 Sample Road, Springfield, GA 30000');

  // With nothing changed, the link opens Communications straight away.
  await open.click();
  await expect(page).toHaveURL(moduleUrl);
});
