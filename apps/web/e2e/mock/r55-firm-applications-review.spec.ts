import { expect, test } from '@playwright/test';

// R55, the Oct 31 review's Firm Applications workflow on screen (SA-APP-F02 to F09, Y01, Y04):
// the new tabs and columns, sort by last activity, the Review card (both statuses, reviewer,
// last activity, request state) with Assign, and the Information Requests card with a response's
// files. Mock mode (Super Admin), 1440 px. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the list shows the review columns, the In Review tab and sorts by last activity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/applications'));
  await page.getByRole('tab', { name: 'In Review (1)' }).click();
  const row = page.getByTestId('application-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Sample Summit CPA Group');
  await expect(row).toContainText('Morgan Admin');
  await expect(row.getByTestId('last-activity')).toContainText('Response received');
  await expect(row.getByTestId('request-state')).toContainText('Response received');
  await page.getByRole('tab', { name: 'All Applications (9)' }).click();
  await page.getByRole('combobox', { name: 'Sort applications' }).selectOption('activity');
  await expect(page).toHaveURL(/order=activity/);
  await expect(page.getByTestId('application-row').first()).toBeVisible();
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/super-admin/applications-review-list.png',
  });
});

test('the review page shows the reviewer, the request and its response files, and reassigns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The mock's In Review application, with a response (it is on the list's second page).
  await page.goto(admin('/applications/0199b6a2-0000-7000-8000-000000000009'));
  const review = page.getByTestId('review-card');
  await expect(review.getByTestId('review-application-status')).toHaveText('In Review');
  await expect(review.getByTestId('review-account-status')).toHaveText('Not created yet');
  await expect(review.getByTestId('review-reviewer')).toHaveText('Morgan Admin');
  await expect(review.getByTestId('review-request-state')).toContainText('Response received');
  const requests = page.getByTestId('requests-card');
  await expect(requests).toContainText('Please send a copy of your firm license.');
  await expect(requests).toContainText('Attached is our license and the signed letter.');
  await expect(
    requests.getByRole('button', { name: 'View or download firm-license.pdf' }),
  ).toBeEnabled();
  await expect(requests).toContainText('Being checked');
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/super-admin/application-review-detail.png',
    fullPage: true,
  });

  // Reassign: the card and the history say so.
  await review.getByLabel('Reassign reviewer').selectOption({ label: 'Sam Reviewer' });
  await review.getByRole('button', { name: 'Reassign' }).click();
  await expect(review.getByTestId('review-reviewer')).toHaveText('Sam Reviewer');
  await expect(page.getByText('Reviewer Assigned').first()).toBeVisible();
});

test('opening a pending application starts its review (SA-APP-F02)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/applications'));
  await page.getByRole('link', { name: 'Open application for Sample Tax Partners LLC' }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('application-status')).toHaveText('In Review');
  await expect(page.getByText('Review Started').first()).toBeVisible();
  await page.getByRole('link', { name: /Back to Applications/i }).click();
  await expect(page.getByRole('tab', { name: 'In Review (2)' })).toBeVisible();
});
