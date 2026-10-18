import { expect, test } from '@playwright/test';

// Settings > Company Profile & Branding, Branding and Client portal in mock mode (the settings
// and branding mocks, as an owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner changes the profile, branding and client portal', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  await expect(page.getByTestId('page-title')).toHaveText('Company Profile & Branding');
  await expect(page.getByText('Sample Legal Name LLC', { exact: false })).toBeVisible();
  await page.getByLabel('Phone Number').fill('(555) 010-0199');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('brand-saved')).toHaveText('Changes saved.');

  const settings = page.getByRole('navigation', { name: 'Settings' });
  await settings.getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Branding');
  await page.getByLabel('Accent colour', { exact: true }).fill('#C9A227');
  await expect(page.getByTestId('brand-preview').getByText('Sign in')).toHaveCSS(
    'background-color',
    'rgb(201, 162, 39)',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  await settings.getByRole('link', { name: 'Client portal' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Client portal settings');
  await page.getByLabel('Welcome message').fill('Welcome, clients.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  // Saved values come back on the next visit (same mock session).
  await settings.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByLabel('Phone Number')).toHaveValue('(555) 010-0199');
  await settings.getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByLabel('Accent colour', { exact: true })).toHaveValue('#c9a227');
});

test('a bad website is caught before saving', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  await page.getByLabel('Website').fill('not a website');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByLabel('Website')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('brand-saved')).toHaveCount(0);
});

test('the header shows the new company name after a save, without a reload', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  await page.getByLabel('Company Name').fill('LVP Tax Partners');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('brand-saved')).toHaveText('Changes saved.');
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Tax Partners');
});

test('only changes are sent: an unchanged save says so, a cleared company name is caught', async ({
  page,
}) => {
  await page.goto(app('/settings/profile'));
  await expect(page.getByLabel('Company Name')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('brand-saved')).toHaveText('Nothing has changed yet.');

  await page.getByLabel('Company Name').fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter a name')).toBeVisible();
});

test('the Live Preview shows an unsaved colour, and Reset asks first', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  const preview = page.getByTestId('live-preview');
  await expect(preview).toBeVisible();
  await page.getByLabel('Company Name').fill('Preview Firm LLC');
  await expect(preview.getByText('Preview Firm LLC').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset to Default Brand Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Reset to Default Brand Settings' })).toBeVisible();
});

test('Company Profile & Branding fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/settings/profile'));
  await expect(page.getByTestId('company-information')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
