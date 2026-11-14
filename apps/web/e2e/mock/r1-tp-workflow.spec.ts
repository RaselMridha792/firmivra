import { expect, test, type Page } from '@playwright/test';

// Tax Planning Review 2, the approved workflow, in mock mode as an Owner: the plan's next action,
// owner and actions fit its status; internal review by a chosen reviewer; one Send control with
// its purpose; a client's request moves it to Needs Review; the client's approval of an exact
// version; Deliver to Client apart from Implemented; requests either way; Duplicate Plan.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tax-planning`;
const year = new Date().getUTCFullYear();

const openPlan = async (page: Page, client: string, plan: string) => {
  await page.goto(`${base}/clients`);
  await page.getByTestId('tp-clients').getByLabel('Search clients').fill(client);
  await page.getByRole('link', { name: plan }).click();
  await expect(page.getByTestId('plan-workflow')).toBeVisible();
};
const action = (page: Page, name: string) =>
  page.getByTestId('workflow-actions').getByRole('button', { name, exact: true });
const dialog = (page: Page) => page.getByRole('dialog');

test('a plan runs from work to internal review, client review, a request, revision, approval and delivery', async ({
  page,
}) => {
  await openPlan(page, 'Mitchell', `${year} Tax Plan`);
  const editor = page.getByTestId('plan-editor');
  await expect(editor).toContainText('In Progress');

  // Internal review by a chosen reviewer: Under Review, the reviewer's to act on.
  await action(page, 'Send for Internal Review').click();
  await page.getByTestId('reviewer-dialog').getByLabel('Reviewer *').selectOption({ index: 1 });
  await dialog(page).getByRole('button', { name: 'Send for Review' }).click();
  await expect(page.getByText('Sent for internal review.')).toBeVisible();
  await expect(editor).toContainText('Under Review');
  await expect(page.getByTestId('workflow-reviewer')).toBeVisible();

  // Finalized, then sent for the client's review: their move; not yet implementable.
  await action(page, 'Finalize Plan').click();
  await expect(page.getByText('Plan finalized.')).toBeVisible();
  await action(page, 'Send to Client').click();
  await expect(page.getByTestId('send-plan').getByLabel('Purpose')).toHaveValue('REVIEW');
  await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(editor).toContainText('Awaiting Client Review');
  await expect(page.getByTestId('workflow-owner')).toHaveText('The client');
  await expect(action(page, 'Mark Implemented')).toHaveCount(0);
  await expect(action(page, 'Deliver to Client')).toHaveCount(0);

  // The client asks for a change: Needs Review; the revision is In Progress again.
  await action(page, "Record Client's Request").click();
  await page
    .getByTestId('request-dialog')
    .getByLabel('The client asked for')
    .selectOption('REVISION');
  await page
    .getByTestId('request-dialog')
    .getByLabel('Their request *')
    .fill('Please add the HSA (fake).');
  await dialog(page).getByRole('button', { name: 'Record Request' }).click();
  await expect(editor).toContainText('Needs Review');
  await expect(page.getByTestId('plan-requests')).toContainText('From the client · Revision');
  await action(page, 'Start Revision').click();
  await expect(page.getByText('Revision started: the plan is In Progress.')).toBeVisible();
  await action(page, 'Finalize Plan').click();
  await expect(page.getByText('Plan finalized.')).toBeVisible();
  await action(page, 'Send to Client').click();
  await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(editor).toContainText('Awaiting Client Review');

  // The client's documented approval of the exact version sent.
  await action(page, 'Record Client Approval').click();
  await page
    .getByTestId('approval-dialog')
    .getByLabel('How it was approved *')
    .fill('Approved by phone (fake).');
  await dialog(page).getByRole('button', { name: 'Record Approval' }).click();
  await expect(page.getByText('Client approval recorded.')).toBeVisible();
  await expect(editor).toContainText('Client Approved');
  await page.getByText(/^Readiness checklist/).click();
  await expect(page.getByTestId('plan-approvals')).toContainText('documented manual approval');

  // Delivery is its own step: the status stays, and Implemented is still to do.
  await expect(action(page, 'Mark Implemented')).toBeVisible();
  await action(page, 'Deliver to Client').click();
  await expect(page.getByTestId('send-plan').getByLabel('Purpose')).toHaveValue('DELIVERY');
  await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('The approved plan was delivered to the client.')).toBeVisible();
  await expect(editor).toContainText('Client Approved');
  await expect(action(page, 'Deliver to Client')).toHaveCount(0);
  await expect(action(page, 'Mark Implemented')).toBeVisible();
});

test('the firm asks the client for a document and marks the request answered', async ({ page }) => {
  await openPlan(page, 'Davis', `${year} S-Corp Review`);
  await action(page, 'Request Information').click();
  await page
    .getByTestId('request-dialog')
    .getByLabel('The client answers with')
    .selectOption('DOCUMENT');
  await page
    .getByTestId('request-dialog')
    .getByLabel('What you need *')
    .fill('Please upload your 1099 (fake).');
  await dialog(page).getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByText('Request sent to the client by a portal message.')).toBeVisible();
  await page.getByText(/^Readiness checklist/).click();
  const requests = page.getByTestId('plan-requests');
  await expect(requests).toContainText('Asked of the client · Document upload');
  await requests.getByRole('button', { name: 'Mark Answered' }).click();
  await page.getByTestId('answer-dialog').getByLabel('The answer *').fill('Received (fake).');
  await dialog(page).getByRole('button', { name: 'Mark Answered' }).click();
  await expect(requests).toContainText('Answered');
  await expect(requests).toContainText('Answer: Received (fake).');
});

test('an implemented plan is delivered; Duplicate Plan makes an editable Draft copy', async ({
  page,
}) => {
  await openPlan(page, 'Thompson', `${year} Corporate Plan`);
  await expect(action(page, 'Mark Implemented')).toHaveCount(0);
  await action(page, 'Deliver to Client').click();
  await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('The approved plan was delivered to the client.')).toBeVisible();
  await expect(page.getByTestId('plan-editor')).toContainText('Implemented');

  await action(page, 'Duplicate Plan').click();
  await expect(page.getByTestId('duplicate-dialog').getByLabel('Name of the copy *')).toHaveValue(
    `${year} Corporate Plan (copy)`,
  );
  await dialog(page).getByRole('button', { name: 'Duplicate Plan' }).click();
  await expect(page.getByTestId('workflow-actions').getByRole('button').first()).toHaveText(
    'Start Work',
  );
  await expect(page.getByTestId('plan-editor')).toContainText('Draft');

  // The clients list offers it too.
  await page.goto(`${base}/clients`);
  await page.getByTestId('tp-clients').getByLabel('Search clients').fill('Thompson');
  await page
    .getByRole('button', { name: /^Actions for Thompson/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Duplicate Plan' }).click();
  await expect(page).toHaveURL(/\/tax-planning\/plans\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByTestId('plan-workflow')).toBeVisible();
});
