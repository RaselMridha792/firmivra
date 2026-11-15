import { expect, type Page, test } from '@playwright/test';

// R60, Tax Returns Review 2 batch 2 (Octavia's checkpoint, Kind P rows). Mock mode as the Owner;
// nothing is sent or filed anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

/** An In Preparation return's Full Review: the first one, or the named client's. */
async function openReview(page: Page, client?: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?status=IN_PREPARATION'));
  const rows = client ? page.getByRole('row').filter({ hasText: client }) : page;
  await rows.getByTestId('return-link').first().click({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Review' }).click({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Open Review, E-File & Filing Status' }).click({
    timeout: 60_000,
  });
  await expect(page.getByTestId('review-actions')).toBeVisible({ timeout: 60_000 });
}

test('F03c: Full Review Create Task opens on the client, the service and the return year', async ({
  page,
}) => {
  await openReview(page);
  await expect(
    page.getByTestId('review-actions').getByRole('link', { name: 'Create Task' }),
  ).toHaveAttribute(
    'href',
    /^\/tasks\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+&period=Tax\+year\+\d{4}&from=/,
  );
});

test("F03db: Send for signature from Full Review makes a request linked to the return's line", async ({
  page,
}) => {
  // A client the Firm Sign mock has too (the API takes any of the firm's clients).
  await openReview(page, 'Jamie Sample');
  const signatures = page.getByTestId('signatures');
  const line = signatures.getByRole('listitem').filter({ hasText: 'Not Sent' }).first();
  await line.getByRole('link', { name: 'Send for signature' }).click();
  await expect(page).toHaveURL(
    /\/firm-sign\/new\?clientId=[0-9a-f-]+(&engagementId=[0-9a-f-]+)?&taxReturnId=[0-9a-f-]+&authorizationId=[0-9a-f-]+/,
    { timeout: 60_000 },
  );
  await page.getByLabel('Document name').fill('Form 8879 (fake)');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare/, { timeout: 60_000 });
  // Back on Full Review (one step back, then its Back link, in the same tab), that line now has
  // the request (Pending), without Link by hand.
  await page.goBack();
  await page.getByTestId('back-to-origin').click({ timeout: 60_000 });
  await expect(signatures).toBeVisible({ timeout: 60_000 });
  await expect(signatures.getByRole('listitem').first()).toContainText('Pending');
});

test('F10b: a request made from a return shows its tax year to the firm and in the portal', async ({
  page,
}) => {
  const jamie = '0199b6a1-0000-7000-8000-000000000001';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${jamie}/documents`));
  const table = page.getByTestId('document-requests').getByTestId('requests-desktop-table');
  const row = table.getByRole('row').filter({ hasText: 'W-2 from your employer' });
  await expect(row.getByTestId('request-tax-year')).toHaveText(' · Tax year 2025', {
    timeout: 60_000,
  });
  await row.getByTestId('request-details').click();
  const details = page.getByTestId('request-details-dialog');
  await expect(details).toContainText('Tax year');
  await expect(details).toContainText('2025 1040 Return');

  await page.goto(`http://portal.localhost:${port}/lvp/documents`);
  const mine = page
    .getByRole('listitem')
    .filter({ hasText: 'W-2 from your employer' })
    .getByTestId('request-tax-year');
  await expect(mine.first()).toHaveText(' · Tax year 2025', { timeout: 60_000 });
});
