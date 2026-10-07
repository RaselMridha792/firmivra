import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

async function mockAdminSession(page: Page, platformAdmin = true) {
  await page.route('**/api/v1/admin/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'reviewer@example.test',
          name: 'Synthetic Reviewer',
          pool: 'ADMIN',
        },
        memberships: [],
        clientAccounts: [],
        platformAdmin,
      }),
    }),
  );
}

test('loads applications from the API mock, filters rows and pages results', async ({ page }) => {
  await mockAdminSession(page);
  await page.goto(admin('/applications'));
  await expect(page.getByTestId('page-title')).toHaveText('Firm Applications');
  await expect(page.getByRole('tab', { name: 'All Applications (6)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pending (3)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approved (2)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Declined (1)' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search applications' }).fill('Sample');
  await expect(page.getByText('Showing 1–4 of 4 applications')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search applications' }).clear();
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('APPROVED');
  await expect(page.getByTestId('application-row')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('');
  await page.getByRole('combobox', { name: 'Filter by date range' }).selectOption('7');
  await expect(page.getByText(/of [1-6] applications/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by date range' }).selectOption('all');
  await page.getByRole('button', { name: 'Next applications page' }).click();
  await expect(page.getByTestId('application-row')).toHaveCount(1);
  await expect(page.getByText('Showing 6–6 of 6 applications')).toBeVisible();
});

test('approves an application and refreshes its status, list and counts', async ({ page }) => {
  await mockAdminSession(page);
  await page.goto(admin('/applications'));
  await page
    .getByRole('link', { name: /Open application for/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Sample Ledger Advisors' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automated Checks' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Application' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByTestId('application-status')).toHaveText('Approved');
  await expect(page.getByTestId('approved-firm-summary')).toBeVisible();
  await page.getByRole('link', { name: /Back to Applications/i }).click();
  await expect(page.getByRole('tab', { name: 'Pending (2)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approved (3)' })).toBeVisible();
});

test('requests information and leaves the application pending', async ({ page }) => {
  await mockAdminSession(page);
  await page.goto(admin('/applications'));
  await page
    .getByRole('link', { name: /Open application for/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Request Information' }).click();
  await page
    .getByRole('textbox', { name: 'Message to the applicant' })
    .fill('Please send your business license.');
  await page.getByRole('dialog').getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Please send your business license.')).toBeVisible();
  await expect(page.getByTestId('application-status')).toHaveText('Pending Review');
  await page.getByRole('link', { name: /Back to Applications/i }).click();
  await expect(page.getByRole('tab', { name: 'Pending (3)' })).toBeVisible();
});

test('declines an application with a recorded reason and refreshed counts', async ({ page }) => {
  await mockAdminSession(page);
  await page.goto(admin('/applications'));
  await page
    .getByRole('link', { name: /Open application for/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Decline Application' }).click();
  await page
    .getByRole('textbox', { name: 'Reason (sent to the applicant)' })
    .fill('The practice is outside our service scope.');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm decline' }).click();
  await expect(page.getByTestId('application-status')).toHaveText('Declined');
  await expect(page.getByText('The practice is outside our service scope.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Application' })).toHaveCount(0);
  await page.getByRole('link', { name: /Back to Applications/i }).click();
  await expect(page.getByRole('tab', { name: 'Pending (2)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Declined (2)' })).toBeVisible();
});

test('saves administrator-only notes and shows not-found for an unknown id', async ({ page }) => {
  await mockAdminSession(page);
  await page.goto(admin('/applications'));
  await page
    .getByRole('link', { name: /Open application for/ })
    .first()
    .click();
  await page
    .getByRole('textbox', { name: 'Internal notes' })
    .fill('Follow up with the synthetic applicant.');
  await page.getByRole('button', { name: 'Save Note' }).click();
  await expect(page.getByText('Notes saved.')).toBeVisible();
  await expect(page.getByText('Notes are only visible to Firmivra administrators.')).toBeVisible();

  await page.goto(admin('/applications/00000000-0000-4000-8000-999999999999'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
});

test('shows a clear no-permission state for a non-admin session', async ({ page }) => {
  await mockAdminSession(page, false);
  await page.goto(admin('/applications'));
  await expect(page.getByTestId('page-forbidden')).toContainText('Super Admin account');
});

test('application list stays within a 375px viewport', async ({ page }) => {
  await mockAdminSession(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(admin('/applications'));
  await expect(page.getByTestId('page-title')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
