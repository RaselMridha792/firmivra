import { expect, test } from '@playwright/test';

// Team and Terms & Privacy in mock mode, as an owner (the team and settings mocks).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner invites, changes a role, resends and deactivates', async ({ page }) => {
  await page.goto(app('/team'));
  await expect(page.getByTestId('page-title')).toHaveText('Team');
  const rows = page.getByTestId('team-row');
  await expect(rows).toHaveCount(6);

  await page.getByLabel('Name', { exact: true }).fill('Taylor Sample');
  await page.getByLabel('Email', { exact: true }).fill('taylor@lvp.test');
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect(rows).toHaveCount(7);

  await page.getByLabel('Role for Sam Staff').selectOption('ADMIN');
  await expect(page.getByLabel('Role for Sam Staff')).toHaveValue('ADMIN');

  const expired = rows.filter({ hasText: 'Eli Expired' });
  await expect(expired).toContainText('Invite expired');
  await expired.getByRole('button', { name: 'Resend invite' }).click();
  await expect(page.getByText('Invite sent again.')).toBeVisible();

  const adam = rows.filter({ hasText: 'Adam Admin' });
  await adam.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(adam).toContainText('Deactivated');
  // The owner's own row has no controls.
  await expect(rows.filter({ hasText: '(you)' }).getByRole('button')).toHaveCount(0);
});

test('an owner publishes a new Terms version and reads an older one', async ({ page }) => {
  await page.goto(app('/settings/legal'));
  await expect(page.getByTestId('page-title')).toHaveText('Terms & Privacy');
  await expect(page.getByTestId('legal-current').first()).toContainText('version 2');
  await page.getByLabel('New version').first().fill('Sample terms, version 3.');
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByTestId('legal-current').first()).toHaveText('Sample terms, version 3.');

  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample terms for testing.');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('tab', { name: 'Privacy Policy' }).click();
  await expect(page.getByRole('button', { name: 'Publish version 2' })).toBeVisible();
});
