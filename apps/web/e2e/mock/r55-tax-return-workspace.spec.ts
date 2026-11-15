import { expect, test } from '@playwright/test';

// R55: a client's tax return in mock mode (mocks/tax-return-workspace.ts, as an Owner): the
// workspace (Frame 2) with its cards and nine tabs, and Review, E-File & Filing Status (Frame 3).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** Opens the first return in a status from the overview's filter. */
async function openReturn(page: import('@playwright/test').Page, status: string) {
  await page.goto(app('/tax-returns'));
  await page.getByTestId('tr-filters').getByLabel('Status', { exact: true }).selectOption(status);
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible();
}

test('the workspace: header, six cards, nine tabs and the overview widgets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReturn(page, 'IN_PREPARATION');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('info-cards').getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('tablist', { name: 'Return sections' }).getByRole('tab')).toHaveCount(
    9,
  );
  await expect(page.getByTestId('return-progress')).toContainText('Preparation');
  await expect(page.getByTestId('client-details')).toBeVisible();
  await expect(page.getByTestId('document-checklist')).toBeVisible();
  await expect(page.getByTestId('upcoming-tasks')).toBeVisible();
  await expect(page.getByTestId('activity')).toContainText('Return created');
  await expect(page.getByTestId('action-bar')).toContainText('Mark as Ready for Review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Tax Returns Review 2 (F01a): on a desktop, Client Details and its two-line address stay in
// their own card, clear of the Document Checklist beside or below it.
test('Client Details with a two-line address never runs into the Document Checklist on a desktop', async ({
  page,
}) => {
  for (const [width, height] of [
    [1165, 747],
    [1280, 800],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(app('/tax-returns?q=Jamie%20Sample'));
    await page.getByTestId('return-link').first().click();
    const details = page.getByTestId('client-details');
    await expect(details).toContainText('123 Main Street', { timeout: 60_000 });
    await expect(details).toContainText('Atlanta, GA 30301');
    const checklist = page.getByTestId('document-checklist');
    await expect(checklist).toBeVisible();
    const a = (await details.boundingBox())!;
    const b = (await checklist.boundingBox())!;
    const overlap =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap, `cards overlap at ${String(width)} px`).toBe(false);
    // Each value, the address too, stays inside the card and inside its own cell.
    const spills = await details.evaluate((card) => {
      const c = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll('dt, dd'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.right > c.right + 1 || r.left < c.left - 1 || el.scrollWidth > el.clientWidth + 1
          );
        })
        .map((el) => el.textContent);
    });
    expect(spills, `at ${String(width)} px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('preparation checklist, review tab and moving to Ready for Review', async ({ page }) => {
  await openReturn(page, 'IN_PREPARATION');
  await page.getByRole('tab', { name: 'Preparation' }).click();
  const list = page.getByTestId('checklist-preparation');
  await list.getByRole('button', { name: 'Add Item' }).click();
  await page.getByTestId('add-check-dialog').getByLabel('Item').fill('Enter K-1 income');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(list).toContainText('Enter K-1 income');
  // The box follows the saved item: click, then wait for the save.
  await list.getByRole('checkbox', { name: 'Enter K-1 income' }).click();
  await expect(page.getByText('Marked done.')).toBeVisible();
  await expect(list.getByRole('checkbox', { name: 'Enter K-1 income' })).toBeChecked();
  await page.getByRole('tab', { name: 'Review' }).click();
  await expect(page.getByTestId('approvals')).toContainText('Preparer Review');
  await page
    .getByTestId('action-bar')
    .getByRole('button', { name: 'Mark as Ready for Review' })
    .click();
  await expect(page.getByText('Moved to Ready for Review.')).toBeVisible();
  await expect(page.getByTestId('action-bar')).toContainText('Mark Ready for Signature');
});

test('Review & E-File: blockers keep Ready to File off until they are cleared', async ({
  page,
}) => {
  await openReturn(page, 'READY_FOR_SIGNATURE');
  await page.getByRole('link', { name: 'View Workflow' }).click();
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await expect(page.getByTestId('review-workflow')).toContainText('Ready to File');
  await expect(page.getByTestId('validation')).toContainText('Warnings');
  const file = page.getByRole('button', { name: 'Mark as Ready to File' });
  await expect(file).toBeDisabled();
  await page.getByTestId('validation').getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText('Warning acknowledged.')).toBeVisible();
  await page.getByRole('button', { name: 'Run Final Validation' }).click();
  await expect(page.getByText('Final validation recorded.')).toBeVisible();
  await expect(page.getByTestId('signatures')).toContainText('Form 8879');
  await expect(page.getByTestId('next-steps')).toContainText('Obtain client signatures');
  await expect(page.getByTestId('efile')).toContainText('Not yet transmitted');
});

test('E-File: record a transmission and its rejection, then retransmit', async ({ page }) => {
  await openReturn(page, 'READY_TO_FILE');
  await page.getByRole('tab', { name: 'E-File' }).click();
  const efile = page.getByTestId('efile');
  await efile.getByTestId('filing-US').getByRole('button', { name: 'Record Transmission' }).click();
  await page.getByTestId('attempt-dialog').getByLabel('Submission ID').fill('SUB-TEST-0001');
  await page.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Transmission recorded.')).toBeVisible();
  await efile
    .getByTestId('filing-US')
    .getByRole('button', { name: 'Record Acknowledgment' })
    .click();
  await page.getByTestId('ack-dialog').getByLabel('Answer').selectOption('REJECTED');
  await page.getByTestId('ack-dialog').getByLabel('Reject code').fill('R0000-504-02');
  // TX-F22: a rejection names its agency (the IRS for the federal filing) and the fix.
  await expect(page.getByTestId('ack-dialog').getByLabel('Rejecting agency')).toHaveValue('IRS');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Record' })).toBeDisabled();
  await page
    .getByTestId('ack-dialog')
    .getByLabel('Corrective action')
    .fill('Correct the dependent and transmit again');
  await page
    .getByTestId('ack-dialog')
    .getByLabel('Description')
    .fill('Fake: the dependent is claimed on another return');
  await page.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await expect(efile.getByTestId('filing-US')).toContainText('IRS · R0000-504-02');
  await efile
    .getByTestId('filing-US')
    .getByRole('button', { name: 'Record Retransmission' })
    .click();
  await page.getByTestId('attempt-dialog').getByLabel('Submission ID').fill('SUB-TEST-0002');
  await page.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await expect(efile.getByTestId('filing-US')).toContainText('Earlier attempts (1)');
  // Tax Returns Review 2 (F24): opened after the retry, the first rejection is all there, with
  // its corrective task owned by the return's preparer.
  const preparer = await page
    .getByTestId('info-cards')
    .getByRole('listitem')
    .filter({ hasText: 'Assigned Preparer' })
    .locator('span[title]')
    .getAttribute('title');
  await efile.getByTestId('filing-US').getByText('Earlier attempts (1)').click();
  const earlier = efile.getByTestId('filing-US').getByTestId('earlier-attempts');
  await expect(earlier).toContainText('SUB-TEST-0001');
  await expect(earlier).toContainText('by IRS (R0000-504-02)');
  await expect(earlier).toContainText('Fake: the dependent is claimed on another return');
  await expect(earlier).toContainText(
    'Corrective action: Correct the dependent and transmit again',
  );
  await expect(earlier).toContainText('Recorded by');
  await expect(earlier.getByTestId('corrective-task')).toContainText(
    `Correct the IRS rejection R0000-504-02 · ${preparer ?? 'no preparer'} · open`,
  );
});

test('Payments & Refunds, Notes and Activity tabs', async ({ page }) => {
  await openReturn(page, 'IN_PREPARATION');
  await page.getByRole('tab', { name: 'Payments & Refunds' }).click();
  await expect(page.getByTestId('summary')).toContainText('Refund');
  await expect(page.getByTestId('summary')).toContainText('not guaranteed');
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByTestId('notes')).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity')).toContainText('Status and assignments');
});
