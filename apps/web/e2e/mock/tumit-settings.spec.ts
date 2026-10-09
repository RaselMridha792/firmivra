import { expect, test } from '@playwright/test';

// Settings > Profile, Branding and Client portal in mock mode (the settings mock, as an owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner changes the profile, branding and client portal', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  await expect(page.getByTestId('page-title')).toHaveText('Firm profile');
  await expect(page.getByText('Sample Legal Name LLC')).toBeVisible();
  await page.getByLabel('Phone').fill('(555) 010-0199');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

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
  await expect(page.getByLabel('Phone')).toHaveValue('(555) 010-0199');
  await settings.getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByLabel('Accent colour', { exact: true })).toHaveValue('#c9a227');
});

test('a bad website is caught before saving', async ({ page }) => {
  await page.goto(app('/settings/profile'));
  await page.getByLabel('Website').fill('not a website');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByLabel('Website')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Changes saved.')).toHaveCount(0);
});

test('the header shows the new firm name after a Profile save, without a reload', async ({
  page,
}) => {
  await page.goto(app('/settings/profile'));
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  await page.getByLabel('Display name (DBA)').fill('LVP Tax Partners');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Tax Partners');
});
