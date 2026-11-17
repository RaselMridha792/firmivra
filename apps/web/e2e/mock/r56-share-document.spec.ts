import { expect, test, type Page } from '@playwright/test';

// R56: Share Document (Documents design, Frame 5) in mock mode: `api.documentLibrary`'s access,
// shares and access history for one document. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const doc = (n: number) => `0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`;

async function open(page: Page, n: number) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/documents/${doc(n)}/share`));
  await expect(page.getByTestId('share-document')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('share-file')).toBeVisible();
}

test('share with the client, change and revoke access, and read the history', async ({ page }) => {
  await open(page, 6);
  await expect(page.getByTestId('share-file')).toContainText('Tax_Return_2024.pdf');
  await expect(page.getByTestId('share-file')).toContainText('Client: Jamie Sample');
  const current = page.getByTestId('current-access');
  await expect(current.getByTestId('share-row')).toHaveCount(1);
  await expect(current).toContainText('View · Download · Upload');
  // Nobody outside the client and the team: those two cards are off.
  await expect(page.getByRole('radio', { name: /External Contact/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Public Link/ })).toBeDisabled();

  await page.getByRole('button', { name: 'Share Document' }).click();
  await expect(page.getByText('Choose who to share it with.')).toBeVisible();
  await page
    .getByLabel('Recipient', { exact: true })
    .selectOption({ label: 'Jamie Sample (jamie.sample@example.test)' });
  await page.getByRole('checkbox', { name: /Allow e-signature/ }).check();
  await page.getByRole('button', { name: 'Share Document' }).click();
  await expect(page.getByText('The document was shared.')).toBeVisible();
  await expect(current.getByTestId('share-row')).toHaveCount(2);
  await expect(current.getByTestId('share-row').nth(1)).toContainText('View · Download · Sign');

  await current.getByRole('button', { name: 'Access of Sam Carter' }).click();
  await page.getByRole('menuitem', { name: 'Change Access' }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /Allow upload/ })
    .uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(current.getByTestId('share-row').first()).toContainText('View · Download');
  await expect(current.getByTestId('share-row').first()).not.toContainText('Upload');

  await current.getByRole('button', { name: 'Access of Jamie Sample' }).click();
  await page.getByRole('menuitem', { name: 'Revoke Access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke Access' }).click();
  await expect(current.getByTestId('share-row')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Access History' }).click();
  const history = page.getByTestId('access-history');
  await expect(history).toContainText('Shared with Jamie Sample');
  await expect(history).toContainText('Access of Jamie Sample revoked');

  await page.getByRole('tab', { name: 'Client Portal Link' }).click();
  await expect(page.getByTestId('portal-link').getByLabel('Client portal link')).toHaveValue(
    /\/lvp\/documents$/,
  );
});

test('an internal document is never shared with the client', async ({ page }) => {
  await open(page, 7);
  await expect(page.getByRole('radio', { name: /^Client/ })).toBeDisabled();
  await expect(page.getByText('Internal documents stay with your team')).toBeVisible();
});

// Clients Review 2 (C2-049): on an internal file, Team Member offered only "Choose a team member"
// with no staff to pick, so it could not be shared at all. It lists the firm's active members
// (never an invited or deactivated one), and choosing one shares the file with them.
test('C2-049: Team Member lists the active staff and shares an internal file with one of them', async ({
  page,
}) => {
  await open(page, 7);
  await expect(page.getByRole('radio', { name: /^Team Member/ })).toBeChecked();
  const recipient = page.getByLabel('Recipient', { exact: true });
  await expect(recipient.locator('option')).toHaveText([
    'Choose a team member',
    'Olivia Owner (olivia@lvp.test)',
    'Adam Admin (adam@lvp.test)',
    'Sam Staff (sam@lvp.test)',
  ]);
  await recipient.selectOption({ label: 'Adam Admin (adam@lvp.test)' });
  await page.getByRole('button', { name: 'Share Document' }).click();
  await expect(page.getByText('The document was shared.')).toBeVisible();
  await expect(page.getByTestId('current-access')).toContainText('Adam Admin');
  // Shared once: Adam is no longer offered.
  await expect(recipient.locator('option')).toHaveText([
    'Choose a team member',
    'Olivia Owner (olivia@lvp.test)',
    'Sam Staff (sam@lvp.test)',
  ]);
});

test('a document that is not there says so', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/not-a-document/share'));
  await expect(page.getByText('This document was not found')).toBeVisible({ timeout: 60_000 });
});
