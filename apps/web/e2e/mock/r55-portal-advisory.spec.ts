// R55, Client Portal Review One BA-CP: the client's Business Advisory under My Services. Reached
// from the advisory service's card; only what the firm marked for the client (delivered plans
// read-only, recommendations shown, tasks not hidden, resources sent, advisory files shared); a
// plan that isn't the client's is the not-found state. B10: the client approves the plan sent for
// their approval, at exactly that version; on the firm side a plan in review goes for approval and
// waits, locked. Mock mode, as client Jamie and the firm's Owner. Synthetic data.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('BA-CP: My Services opens Business Advisory, which shows only what the firm shared', async ({
  page,
}) => {
  await page.goto(portal('/lvp/services'));
  await page.getByRole('tab', { name: /^Recurring/ }).click();
  await page.getByTestId('service-advisory-link').click();
  await expect(page).toHaveURL(portal('/lvp/services/advisory'), { timeout: 60_000 });
  await expect(page).toHaveTitle('Business Advisory');

  await expect(page.getByTestId('advisory-summary')).toContainText('Sample Bakery LLC');
  await expect(page.getByTestId('advisory-summary')).toContainText('Your advisor: Olivia Owner');
  const plans = page.getByTestId('advisory-plan-row');
  await expect(plans).toHaveCount(3);
  const growth = plans.filter({ hasText: '2026 Growth Plan (sample)' });
  await expect(growth).toContainText('Version 2');
  await expect(growth).toContainText('Delivered');
  await expect(plans.filter({ hasText: '2025 Launch Plan (sample)' })).toContainText(
    'The firm is preparing a new version',
  );

  const recs = page.getByTestId('advisory-recommendation');
  await expect(recs).toHaveCount(2);
  await expect(recs.first()).toContainText('Apply for an SBA 7(a) loan');
  await expect(recs.nth(1)).toContainText('Expected: +8% Profit');
  const tasks = page.getByTestId('advisory-task');
  await expect(tasks.first()).toContainText('Overdue');
  await expect(tasks.first()).toContainText('For you');
  await expect(tasks.nth(1)).toContainText('Your firm is on it');
  await expect(
    page.getByTestId('advisory-resource').filter({ hasText: 'Funding Readiness Checklist' }),
  ).toHaveCount(1);
  await expect(page.getByTestId('advisory-files')).toContainText('Second shop budget (sample).pdf');
  await expect(page.getByTestId('advisory-disclaimer')).toContainText('not guarantees');
  // Nothing on the page edits anything.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  // My Services stays the lit menu line.
  await expect(page.getByRole('link', { name: 'My Services' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('BA-CP: a delivered plan opens read-only at the version delivered', async ({ page }) => {
  await page.goto(portal('/lvp/services/advisory'));
  await page
    .getByTestId('advisory-plan-row')
    .filter({ hasText: '2026 Growth Plan (sample)' })
    .getByRole('link')
    .click();
  await expect(page.getByTestId('page-title')).toHaveText('2026 Growth Plan (sample)', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('read-only-note')).toHaveText(
    'Read-only: version 2, exactly as your firm delivered it.',
  );
  await expect(page.getByTestId('plan-summary')).toContainText('Open a second location');
  await expect(page.getByTestId('plan-focus')).toContainText('Expansion');
  await expect(page.getByTestId('plan-goals')).toContainText('Sign a lease for the second shop');
  await expect(page.getByTestId('plan-recommendations')).toContainText(
    'Apply for an SBA 7(a) loan',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('link', { name: '← Business Advisory' }).click();
  await expect(page).toHaveURL(portal('/lvp/services/advisory'));
});

test("BA-CP: a plan that isn't the client's shows the not-found state", async ({ page }) => {
  await page.goto(portal('/lvp/services/advisory/plans/0199d600-0000-7000-8000-000000000003'));
  await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('page-title')).toHaveCount(0);
});

test('B10: the client approves the plan sent for their approval, at exactly that version', async ({
  page,
}) => {
  await page.goto(portal('/lvp/services/advisory'));
  const callout = page.getByTestId('advisory-approval-callout');
  await expect(callout).toContainText('A business plan is waiting for your approval.', {
    timeout: 60_000,
  });
  await expect(
    page.getByTestId('advisory-plan-row').filter({ hasText: '2027 Expansion Plan (sample)' }),
  ).toContainText('Awaiting your approval');
  await callout.getByRole('link', { name: /Review and approve 2027 Expansion Plan/ }).click();
  await expect(page.getByTestId('page-title')).toHaveText('2027 Expansion Plan (sample)');
  await expect(page.getByTestId('read-only-note')).toHaveText(
    'Read-only: version 1, exactly as your firm delivered it.',
  );
  await expect(page.getByTestId('plan-recommendations')).toContainText(
    'Lease the van instead of buying it',
  );

  await page.getByRole('button', { name: 'Approve Plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve Plan' });
  await expect(dialog).toContainText('You approve version 1 exactly as your firm sent it');
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('plan-notice')).toContainText('You approved version 1.');
  await expect(page.getByTestId('plan-approval')).toContainText('You approved version 1 on');
  await expect(page.getByRole('button', { name: 'Approve Plan' })).toHaveCount(0);
  await expect(page.getByTestId('advisory-plan-header')).toContainText('Approved');

  // The overview no longer asks; the plan shows the approval.
  await page.getByRole('link', { name: '← Business Advisory' }).click();
  await expect(page.getByTestId('advisory-plans')).toBeVisible();
  await expect(page.getByTestId('advisory-approval-callout')).toHaveCount(0);
  await expect(
    page.getByTestId('advisory-plan-row').filter({ hasText: '2027 Expansion Plan (sample)' }),
  ).toContainText('You approved version 1 on');
  // A plan that isn't waiting offers no Approve.
  await page
    .getByTestId('advisory-plan-row')
    .filter({ hasText: '2026 Growth Plan (sample)' })
    .getByRole('link')
    .click();
  await expect(page.getByTestId('page-title')).toHaveText('2026 Growth Plan (sample)');
  await expect(page.getByRole('button', { name: 'Approve Plan' })).toHaveCount(0);
});

test('B10 (firm): a plan in review goes for client approval and waits, locked', async ({
  page,
}) => {
  await page.goto(app('/business-advisory/plans'));
  const list = page.getByTestId('ba-plans');
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click({
    timeout: 60_000,
  });
  await page.getByRole('menuitem', { name: 'Send for Client Approval' }).click();
  const dialog = page.getByTestId('request-approval');
  await expect(dialog).toContainText('Their approval finalizes the plan.');
  await dialog.getByLabel('Message to the client (optional)').fill('Please read it (fake).');
  await page.getByTestId('send-for-approval').click();
  await expect(
    page.getByText('Fleet Expansion Plan sent to Kevin Martin for approval.'),
  ).toBeVisible();
  const row = list.getByRole('row').filter({ hasText: 'Fleet Expansion Plan' });
  await expect(row).toContainText('Awaiting Client Approval');
  // Locked while the client reads it: no finalize or send; Modify Plan withdraws the request.
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await expect(page.getByRole('menuitem', { name: 'Finalize Plan' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Send to Client' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Send for Client Approval' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Modify Plan' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    "the client's approval request is withdrawn",
  );
});
