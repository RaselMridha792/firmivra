// R60, Tax Planning P4-8 (the lead's decision of Nov 17): the client's portal Tax Plans. The menu
// line, the list, a plan read-only at the version sent, Approve of that exact version, and the
// three requests (a question, a revision, a meeting) that send the plan to the firm. A closed plan
// takes no request. Mock mode, as client Jamie. Synthetic data only.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

/** Opens a plan of the list by name, in the app (the mock keeps what was done). */
async function openPlan(page: Page, name: string) {
  await page.getByTestId('tax-plan-row').filter({ hasText: name }).getByRole('link').click();
  await expect(page.getByTestId('page-title')).toHaveText(name, { timeout: 60_000 });
}

test('P4-8: Tax Plans is in the menu and lists the plans sent, each with where it stands', async ({
  page,
}) => {
  await page.goto(portal('/lvp/home'));
  await page.getByRole('link', { name: 'Tax Plans' }).first().click();
  await expect(page).toHaveURL(portal('/lvp/tax-plans'), { timeout: 60_000 });
  const rows = page.getByTestId('tax-plan-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: '2026 Tax Strategy (sample)' })).toContainText('Version 2');
  await expect(rows.filter({ hasText: '2026 Tax Strategy (sample)' })).toContainText(
    'Awaiting your review',
  );
  await expect(rows.filter({ hasText: '2025 Year-End Plan (sample)' })).toContainText('Approved');
  await expect(rows.filter({ hasText: '2024 Plan (sample)' })).toContainText('Closed');
});

test('P4-8: a plan opens read-only at the version sent, and Approve records that version', async ({
  page,
}) => {
  await page.goto(portal('/lvp/tax-plans'));
  await openPlan(page, '2026 Tax Strategy (sample)');
  await expect(page.getByTestId('read-only-note')).toHaveText(
    'Read-only: version 2, exactly as the firm sent it.',
  );
  await expect(page.getByTestId('plan-strategies')).toContainText('Retirement contributions');
  await expect(page.getByTestId('plan-strategies')).toContainText('Not estimated');
  await expect(page.getByTestId('projected-savings')).toHaveText('Projected savings: $5,350');
  // Nothing on the page edits the plan.
  await expect(page.getByRole('textbox')).toHaveCount(0);

  await page.getByRole('button', { name: 'Approve Plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve Plan' });
  await expect(dialog).toContainText('You approve version 2 exactly as the firm sent it');
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('plan-notice')).toContainText('You approved version 2.');
  await expect(page.getByTestId('plan-approval')).toContainText('You approved version 2 on');
  await expect(page.getByTestId('plan-approval')).toContainText('in the portal');
  await expect(page.getByRole('button', { name: 'Approve Plan' })).toHaveCount(0);
  await expect(page.getByTestId('tax-plan-header')).toContainText('Approved');
});

test('P4-8: Ask a Question, Request a Revision and Request a Meeting send the plan to the firm', async ({
  page,
}) => {
  await page.goto(portal('/lvp/tax-plans'));
  await openPlan(page, '2026 Tax Strategy (sample)');
  const ask = async (button: string, text: string) => {
    await page.getByRole('button', { name: button }).click();
    const dialog = page.getByRole('dialog', { name: button });
    const send = dialog.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await dialog.getByLabel('Your request').fill(text);
    await send.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('plan-notice')).toContainText('The firm will answer by message.');
  };
  await ask('Ask a Question', 'Synthetic question about the home office.');
  await expect(page.getByTestId('tax-plan-header')).toContainText('Your request is with the firm');
  await ask('Request a Revision', 'Synthetic revision: leave out charitable bunching.');
  await ask('Request a Meeting', 'Synthetic: any Tuesday afternoon.');
  const requests = page.getByTestId('plan-requests');
  await expect(requests.getByRole('listitem')).toHaveCount(3);
  await expect(requests).toContainText('Question · Sent');
  await expect(requests).toContainText('Revision request · Sent');
  await expect(requests).toContainText('Meeting request · Sent');
});

test('P4-8: a closed plan takes no request', async ({ page }) => {
  await page.goto(portal('/lvp/tax-plans'));
  await openPlan(page, '2024 Plan (sample)');
  await expect(page.getByTestId('plan-actions')).toHaveCount(0);
  await expect(page.getByText('This plan is closed.')).toBeVisible();
});
