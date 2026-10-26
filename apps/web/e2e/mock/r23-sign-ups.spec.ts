import { expect, test } from '@playwright/test';

// Client sign-ups (R23) on the clientSignUps mock, as the Owner, on Octavia's Client Sign-ups
// design (Oct 25): the request opens in the panel, Approve asks first, Decline takes a reason.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the owner approves and declines sign-ups from the request panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/sign-ups'));
  await expect(page.getByTestId('page-title')).toHaveText('Client sign-ups');
  const rows = page.getByTestId('sign-up-row');
  await expect(rows).toHaveCount(4, { timeout: 60_000 });
  const panel = page.getByTestId('sign-up-panel');

  // John Doe has no match: Approve asks, naming the firm, then opens his portal.
  await page.getByRole('button', { name: "Review John Doe's request" }).click();
  await expect(panel).toContainText('No match found');
  await panel.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve John Doe?' });
  await expect(approve).toContainText('LVP Accounting & Taxes');
  await approve.getByRole('button', { name: 'Cancel' }).click();
  await expect(approve).toBeHidden();
  await expect(panel).toContainText('Pending');
  await panel.getByRole('button', { name: 'Approve' }).click();
  await approve.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText('John Doe is approved');
  await expect(page.getByRole('link', { name: 'Open client record' }).first()).toBeVisible();
  await expect(panel).toContainText(/Approved .* by Fake Owner/);
  await expect(panel).toContainText(/Client ID CL-\d+/);
  await expect(rows).toHaveCount(3);

  // Lee Roe: declined with a reason only the firm sees.
  await page.getByRole('button', { name: "Review Lee Roe's request" }).click();
  await panel.getByRole('button', { name: 'Decline' }).click();
  const decline = page.getByRole('dialog');
  await decline.getByLabel('Reason (optional)').fill('Not a client of ours');
  await decline.getByRole('button', { name: 'Decline' }).click();
  await expect(decline).toBeHidden();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    "Lee Roe's sign-up was declined.",
  );
  await expect(panel).toContainText('Reason (your firm only): Not a client of ours');

  await page.getByRole('tab', { name: /Declined/ }).click();
  await expect(rows.filter({ hasText: 'Lee Roe' })).toContainText('Declined');
  await page.getByRole('tab', { name: /Approved/ }).click();
  await expect(rows.filter({ hasText: 'John Doe' })).toContainText(/CL-\d+/);
});

test('sign-ups fit a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/sign-ups'));
  await expect(page.getByTestId('sign-up-row')).toHaveCount(4, { timeout: 60_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
