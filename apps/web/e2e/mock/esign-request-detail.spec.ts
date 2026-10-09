import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** The mock's requests (its fixtures, in the mockup's order). */
const REQUESTS = {
  'Tax Engagement Letter 2026': '0199b6e0-0000-7000-8000-000000000001',
  'Payroll Authorization': '0199b6e0-0000-7000-8000-000000000004',
};

/** Mock seeds by id: a draft, in person, declined, needing approval, and one that isn't there. */
const ID = {
  draft: '0199b6e0-0000-7000-8000-000000000006',
  inPerson: '0199b6e0-0000-7000-8000-000000000096',
  declined: '0199b6e0-0000-7000-8000-000000000092',
  approval: '0199b6e0-0000-7000-8000-000000000005',
  unknown: '0199b6e0-0000-7000-8000-000000000999',
};

async function openId(page: Page, id: string) {
  await page.goto(app(`/firm-sign/requests/${id}`));
  await expect(page.getByTestId('page-title')).toBeVisible();
}

async function open(page: Page, title: keyof typeof REQUESTS) {
  await page.goto(app(`/firm-sign/requests/${REQUESTS[title]}`));
  await expect(page.getByTestId('page-title')).toHaveText(title);
}

test('a completed request: recipients and timeline', async ({ page }) => {
  await open(page, 'Tax Engagement Letter 2026');
  await expect(page.getByTestId('request-status')).toHaveText('Completed');
  const recipient = page.getByTestId('recipient');
  await expect(recipient).toHaveCount(1);
  await expect(recipient).toContainText('John Smith');
  await expect(recipient).toContainText('Signed');
  const timeline = page.getByTestId('timeline').getByRole('listitem');
  // Newest first: completed, signed, viewed, sent, created.
  await expect(timeline.first()).toContainText('Completed');
  await expect(timeline.last()).toContainText('Created');
  await expect(page.getByTestId('timeline')).toContainText('Verified by an email code');
  await expect(page.getByRole('link', { name: 'Continue preparing' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in person' })).toHaveCount(0);
});

test('a draft: continue preparing, and the internal note', async ({ page }) => {
  await openId(page, ID.draft);
  await expect(page.getByRole('link', { name: 'Continue preparing' })).toHaveAttribute(
    'href',
    `/firm-sign/requests/${ID.draft}/prepare`,
  );
  await expect(page.getByText('Synthetic note: staff only.')).toBeVisible();
  await expect(page.getByText('Prepared by')).toBeVisible();
});

test('an in-person request links to the kiosk', async ({ page }) => {
  await openId(page, ID.inPerson);
  await expect(page.getByRole('link', { name: 'Sign in person' })).toHaveAttribute(
    'href',
    `/firm-sign/in-person/${ID.inPerson}`,
  );
});

test("a declined request shows the signer's reason twice", async ({ page }) => {
  await openId(page, ID.declined);
  const reason = 'Reason: The fee is not what we agreed.';
  await expect(page.getByTestId('recipient').getByText(reason)).toBeVisible();
  await expect(page.getByTestId('timeline').getByText(reason)).toBeVisible();
});

test('a request needing approval puts its approver first', async ({ page }) => {
  await openId(page, ID.approval);
  // The Owner (Mock User) is its approver.
  await expect(page.getByText('Waiting for your approval.')).toBeVisible();
  const first = page.getByTestId('recipient').first();
  await expect(first).toContainText('Mock User');
  await expect(first).toContainText('Awaiting approval');
});

test('an unknown request is not found', async ({ page }) => {
  await page.goto(app(`/firm-sign/requests/${ID.unknown}`));
  await expect(page.getByText("We couldn't find this.")).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Signature request' })).toBeAttached();
});

test('a request part-way through says who it waits on', async ({ page }) => {
  await open(page, 'Payroll Authorization');
  await expect(page.getByText('Waiting for Jordan Brown to sign.')).toBeVisible();
  const recipients = page.getByTestId('recipient');
  await expect(recipients).toHaveCount(2);
  await expect(recipients.first()).toContainText('1. Alex Brown');
  await expect(recipients.nth(1)).toContainText('Viewed');
});

test('a mistyped request link is not found', async ({ page }) => {
  await page.goto(app('/firm-sign/requests/not-a-request'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('request detail fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page, 'Payroll Authorization');
  await expect(page.getByTestId('timeline')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
