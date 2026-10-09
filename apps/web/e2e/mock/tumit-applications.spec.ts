import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('loads applications from the API mock, filters rows and pages results', async ({ page }) => {
  await page.goto(admin('/applications'));
  await expect(page.getByTestId('page-title')).toHaveText('Firm Applications');
  await expect(page.getByRole('tab', { name: 'All Applications (8)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pending (4)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approved (3)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Declined (1)' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search applications' }).fill('Harbor');
  await expect(page.getByTestId('application-row')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search applications' }).clear();
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('APPROVED');
  await expect(page.getByTestId('application-row')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('');
  await page.getByRole('combobox', { name: 'Filter by date range' }).selectOption('7');
  await expect(page.getByText(/of [1-6] applications/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by date range' }).selectOption('all');
  await page.getByRole('button', { name: 'Next applications page' }).click();
  await expect(page.getByTestId('application-row')).toHaveCount(3);
  await expect(page.getByText('Showing 6–8 of 8 applications')).toBeVisible();
});

test('reviews an unreadable application from its stored columns without losing actions', async ({
  page,
}) => {
  await page.goto(admin('/applications'));
  await page
    .getByRole('searchbox', { name: 'Search applications' })
    .fill('Sample Harbor Tax Services');
  const row = page.getByTestId('application-row');
  await expect(row).toContainText('Sample Harbor Tax Services');
  await expect(row).toContainText('Drew Sample');
  await expect(row).toContainText('—');
  await row.getByRole('link', { name: 'Open Application' }).click();

  await expect(page.getByRole('heading', { name: 'Sample Harbor Tax Services' })).toBeVisible();
  await expect(page.getByText('Drew Sample', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The application form could not be read', { exact: true }),
  ).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Approve Application' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Request Information' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Decline Application' })).toBeEnabled();
});

test('approves an application and refreshes its status, list and counts', async ({ page }) => {
  await page.goto(admin('/applications'));
  await page
    .getByRole('link', { name: /Open application for/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Sample Ledger Advisors' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automated Checks' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Application' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm approval' }).click();
  // Approved: the title shows the new firm's status, and the line under it the approval date.
  await expect(page.getByTestId('application-status')).toHaveText('Pending Setup');
  await expect(page.getByTestId('approved-firm-summary')).toContainText('Approved on');
  // Once approved: no decision buttons, a link to the firm site, and the owner invite in the timeline.
  await expect(page.getByRole('button', { name: 'Approve Application' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open Firm Workspace/ })).toHaveAttribute(
    'href',
    /^https?:\/\/app\.[^/]+\/$/,
  );
  await expect(page.getByText('(404) 555-0103', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'riley@sample-ledger.example.test' }),
  ).toHaveAttribute('href', 'mailto:riley@sample-ledger.example.test');
  await expect(page.getByText('Owner Invited', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Activation link sent to riley@sample-ledger.example.test.'),
  ).toBeVisible();
  await page.getByRole('link', { name: /Back to Applications/i }).click();
  await expect(page.getByRole('tab', { name: 'Pending (3)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approved (4)' })).toBeVisible();
});

test('requests information and leaves the application pending', async ({ page }) => {
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
  await expect(page.getByRole('tab', { name: 'Pending (4)' })).toBeVisible();
});

test('declines an application with a recorded reason and refreshed counts', async ({ page }) => {
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
  await expect(page.getByRole('tab', { name: 'Pending (3)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Declined (2)' })).toBeVisible();
});

test('saves administrator-only notes and shows not-found for an unknown id', async ({ page }) => {
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

  await page.goto(admin('/applications/not-a-valid-id'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
});

test('application list stays within a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(admin('/applications'));
  await expect(page.getByTestId('page-title')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

test('pending and approved application pages stay within a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of ['Sample Ledger Advisors', 'Sample Riverside Tax Co']) {
    await page.goto(admin('/applications'));
    await page.getByRole('link', { name: `Open application for ${name}` }).click();
    await expect(page.getByTestId('page-title')).toHaveText(name);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(375);
  }
});
