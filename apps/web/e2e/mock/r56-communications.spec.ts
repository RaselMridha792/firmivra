import { expect, test } from '@playwright/test';

// R56: the Communications module in mock mode (playwright.mock.config.ts runs every module on mock
// data, as an Owner). Seeded: five sent campaigns (2026 Tax Season Reminder is the first), three
// scheduled, one sending, two drafts ("Referral Request" has no recipients), and nine segments.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

test('Overview: quick cards, KPIs, recent list and the right rail', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Communications', level: 1 })).toBeVisible();
  await expect(page.getByTestId('quick-cards').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByTestId('comm-kpis').getByRole('listitem')).toHaveCount(4);
  await expect(
    page.getByRole('tablist', { name: 'Communication views' }).getByRole('tab'),
  ).toHaveCount(8);
  await expect(page.getByTestId('recent').getByTestId('comm-link').first()).toBeVisible();
  await expect(page.getByTestId('upcoming')).toContainText('Upcoming Communications');
  await expect(page.getByTestId('saved-templates')).toContainText('Saved Templates');
  await expect(page.getByTestId('quick-actions')).toContainText('Quick Actions');
});

test('Tabs: scheduled, sent history, announcements and the search', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Scheduled' }).click();
  await expect(page.getByTestId('comm-list').getByTestId('comm-link')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Announcements' }).click();
  await expect(page.getByTestId('comm-list')).toContainText('New Portal Features');
  await page.getByRole('tab', { name: 'Sent History' }).click();
  await page.getByLabel('Search communications').fill('newsletter');
  await expect(page.getByTestId('comm-list').getByTestId('comm-link')).toHaveCount(1);
});

test('Create New: an email draft opens the composer with the checklist', async ({ page }) => {
  await page.goto(base);
  await page.getByTestId('quick-email').click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('checklist')).toContainText('Choose recipients first.');
  await expect(page.getByRole('button', { name: /Review/ }).first()).toBeEnabled();
});

test('Composer: choose recipients, review and send, then see the results', async ({ page }) => {
  await page.goto(`${base}/new?channel=EMAIL`);
  await page.waitForURL(/\/edit$/);
  await page.getByLabel('Campaign Name').fill('Spring Check-In');
  await page.getByLabel('Subject Line').fill('A quick hello');
  await page
    .getByTestId('composer-form')
    .getByRole('textbox', { name: /Message/ })
    .fill('Hello [Client First Name], thank you.');
  await page.getByRole('button', { name: 'Choose Recipients' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel(/Small Business Clients/).check();
  await expect(modal.getByTestId('selected-audience')).toContainText('Small Business Clients');
  await expect(modal.getByTestId('final-total')).not.toHaveText('0');
  await expect(modal.getByTestId('exclusions')).toContainText('Unsubscribed contacts');
  await modal.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByTestId('audience-count')).toContainText('can receive this message');
  await page
    .getByRole('button', { name: /^Review/ })
    .first()
    .click();
  const review = page.getByTestId('review-dialog');
  await expect(review.getByTestId('review-count')).toContainText('selected');
  await expect(review.getByTestId('review-excluded')).toContainText('unsubscribed');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Send to/ })
    .click();
  await page.waitForURL(/\/communications\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'A quick hello', level: 1 })).toBeVisible();
  await expect(page.getByTestId('result-kpis')).toBeVisible();
});

test('Composer: switching to a text message counts its parts', async ({ page }) => {
  await page.goto(`${base}/new?channel=EMAIL`);
  await page.waitForURL(/\/edit$/);
  await page
    .getByTestId('composer-form')
    .getByRole('textbox', { name: /Message/ })
    .fill('Some words');
  await page.getByRole('button', { name: 'Save Draft' }).first().click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Text Message' }).click();
  await expect(page.getByTestId('sms-count')).toContainText('text part');
  await page.getByRole('tab', { name: 'Announcement' }).click();
  await expect(page.getByTestId('announcement-window')).toBeVisible();
});

test('Composer: send a test, an unknown field is flagged, a draft can use a template', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Bulk Campaigns' }).click();
  await page.getByRole('link', { name: 'Referral Request' }).click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('template-card').getByRole('button', { name: 'Use a Template' }).click();
  await expect(page.getByTestId('template-list')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Send Test' }).first().click();
  await page.getByRole('dialog').getByLabel('Send a test to').fill('owner@example.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Test' }).click();
  await expect(page.getByText('Test sent.')).toBeVisible();
});

test('Results: tabs, follow-up and duplicate make new drafts', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Sent History' }).click();
  await page.getByRole('link', { name: '2026 Tax Season Reminder' }).click();
  await expect(page.getByTestId('result-kpis')).toBeVisible();
  await expect(page.getByTestId('performance')).toBeVisible();
  await page.getByRole('tab', { name: 'Recipients' }).click();
  await expect(page.getByTestId('recipient-table')).toBeVisible();
  await page.getByRole('tab', { name: 'Message' }).click();
  await expect(page.getByTestId('message-tab')).toContainText('Tax season');
  await page.getByRole('button', { name: 'Send Follow-Up' }).click();
  await page.getByRole('button', { name: 'Did not open the message' }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByLabel('Campaign Name')).toHaveValue(/Follow-up/);
});

test('Segments: search, create a segment with a live count, and view members', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Segments & Lists' }).click();
  await expect(page.getByTestId('segments-panel')).toContainText('All Clients');
  await page.getByRole('button', { name: 'New Segment' }).click();
  const dialog = page.getByTestId('segment-dialog');
  await dialog.getByLabel('Name').fill('Georgia Payroll');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog.getByTestId('segment-count')).toContainText('match');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('segments-panel')).toContainText('Georgia Payroll');
  await page.getByRole('button', { name: 'Georgia Payroll', exact: true }).click();
  await expect(page.getByTestId('members-dialog')).toBeVisible();
});

test('Row actions: cancel a scheduled send', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Scheduled' }).click();
  await page.getByRole('button', { name: 'Actions for Tax Prep Reminder' }).click();
  await page.getByRole('menuitem', { name: 'Cancel Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel Send' }).click();
  await expect(page.getByText('Cancelled.')).toBeVisible();
  await expect(page.getByTestId('comm-list').getByTestId('comm-link')).toHaveCount(2);
});
