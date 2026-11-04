import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review, the Overview (playwright.mock.config.ts, as an
// Owner; the mock answers as the API): CM-F01 the KPI cards, CM-F02 the segments guidance, CM-F03
// Choose Recipients for a draft, CM-F04 a channel that is not connected.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

test('CM-F01: each KPI card opens Sent History with its filter kept', async ({ page }) => {
  await page.goto(base);
  const kpis = page.getByTestId('comm-kpis');
  const list = page.getByTestId('comm-list');
  const type = list.getByLabel('Type');

  await kpis.getByRole('button', { name: /Emails Sent/ }).click();
  await expect(page.getByRole('tab', { name: 'Sent History' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(type).toHaveValue('EMAIL');
  await expect(list.getByTestId('comm-link').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Overview' }).click();
  await kpis.getByRole('button', { name: /Texts Sent/ }).click();
  await expect(type).toHaveValue('SMS');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await kpis.getByRole('button', { name: /Total Sent/ }).click();
  await expect(type).toHaveValue('');
});

test('CM-F02: Grow Your Reach opens Segments & Lists with how to build an audience', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByTestId('reach').getByRole('button', { name: 'Manage segments' }).click();
  const panel = page.getByTestId('segments-panel');
  await expect(panel.getByTestId('segments-guide')).toContainText('A segment follows rules');
  // Nothing is chosen or opened for you.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('CM-F03: Choose Recipients opens a draft with its chooser, and Manage Segments stays apart', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByTestId('quick-segments')).toContainText('Manage Segments');
  await page
    .getByTestId('start-new')
    .getByRole('button', { name: /Choose Recipients/ })
    .click();
  const picker = page.getByRole('dialog', { name: 'Choose Recipients' });
  await expect(picker.getByTestId('draft-picker')).toBeVisible();
  await picker.getByRole('link', { name: /Referral Request/ }).click();

  await page.waitForURL(/\/edit\?recipients=1$/);
  const modal = page.getByTestId('recipients-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('checkbox', { disabled: false }).first().check();
  await page.getByRole('button', { name: /^Apply \d+ Recipients$/ }).click();
  await expect(modal).toBeHidden();
  // Back on the draft: its chips and final count, and the address no longer reopens the chooser.
  await expect(page).toHaveURL(/\/edit$/);
  const field = page.getByTestId('recipients-field');
  await expect(field.getByText('No recipients chosen yet')).toHaveCount(0);
  await expect(field.getByTestId('audience-count')).toContainText('can receive this message');
});

test('CM-F03: or a new email is started for the recipients', async ({ page }) => {
  await page.goto(base);
  await page
    .getByTestId('start-new')
    .getByRole('button', { name: /Choose Recipients/ })
    .click();
  await page.getByRole('button', { name: 'Start a New Email' }).click();
  await page.waitForURL(/\/edit\?recipients=1$/);
  await expect(page.getByTestId('recipients-modal')).toBeVisible();
});

test('CM-F04: an Email that is not connected links an Owner to Integrations and back', async ({
  page,
}) => {
  await page.goto(`${base}?mockState=email-off`);
  await page.getByRole('button', { name: 'New Communication' }).click();
  await page.getByRole('menuitem', { name: 'New Email' }).click();
  const note = page.getByTestId('channel-notice');
  await expect(note).toContainText('Email is not connected');
  await expect(note.getByRole('link', { name: 'Connect Email in Integrations' })).toHaveAttribute(
    'href',
    '/integrations?from=%2Fcommunications',
  );
  // Text is connected: it starts as before.
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'New Communication' }).click();
  await page.getByRole('menuitem', { name: 'New Text Message' }).click();
  await page.waitForURL(/\/edit$/);
});
