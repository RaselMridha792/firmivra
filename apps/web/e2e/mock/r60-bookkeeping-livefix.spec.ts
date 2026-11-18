// R60, the Bookkeeping live check's failed rows: E01a A01 (View All opened a client Activity page
// without the bookkeeping events, and raw codes: "Status changed from NOT_STARTED to OVERDUE",
// "Note added GENERAL") and C05 (the Activity card and report versions used the browser's time
// zone). Mock mode, as an Owner. The browser is in Dhaka, the firm in New York, so a time in the
// wrong zone is 10 to 11 hours off.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const FIRM_ZONE = 'America/New_York';
/** A raw enum code in a sentence ("NOT_STARTED", "GENERAL", "OVERDUE"). */
const RAW_CODE = /\b(NOT_STARTED|ON_TRACK|NEEDS_ATTENTION|MISSING_DOCUMENTS|OVERDUE|GENERAL)\b/;
const clock = (text: string) => /\d{1,2}:\d{2}\s?[AP]M/.exec(text)?.[0];

test.use({ timezoneId: 'Asia/Dhaka' });

test('E01a A01: the client Activity page lists the bookkeeping events in words, as the card does', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: 'Actions for Green Leaf Café LLC' }).click();
  await page.getByRole('menuitem', { name: 'Update Bookkeeping Status' }).click();
  await page.getByRole('dialog').getByLabel('Status').selectOption('OVERDUE');
  await page.getByRole('dialog').getByRole('button', { name: 'Update Status' }).click();
  await expect(page.getByText('Status updated.')).toBeVisible();

  // The card: the status change in words, never its codes.
  await page
    .getByRole('link', { name: /Green Leaf Café LLC/ })
    .first()
    .click();
  const card = page.getByTestId('client-activity');
  const first = card.getByRole('listitem').first();
  await expect(first).toContainText(/Status changed from .+ to Overdue/);
  await expect(card).not.toContainText(RAW_CODE);

  // A General note, written here.
  const notes = page.getByTestId('shared-notes');
  await notes.getByRole('button', { name: 'Add Note' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Note', { exact: true }).fill('Fake: asked for the March statement');
  await dialog.getByRole('button', { name: 'Save Note' }).click();
  await expect(dialog).toBeHidden();

  // View All: the client's Activity page has the card's events, and the note's type in words.
  const cardTime = clock(await first.innerText());
  await card.getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/activity/);
  const activity = page.getByTestId('client-activity');
  const status = activity
    .getByTestId('activity-entry')
    .filter({ hasText: /Status changed from .+ to Overdue/ });
  await expect(status).toHaveCount(1);
  await expect(status).toContainText('Bookkeeping');
  await expect(
    activity.getByTestId('activity-entry').filter({ hasText: 'Note added' }).first(),
  ).toContainText('General note');
  await expect(activity).not.toContainText(RAW_CODE);

  // C05: the card and the page show the same event at the same firm time.
  expect(cardTime).toBeTruthy();
  expect(clock(await status.innerText())).toBe(cardTime);
});

test('C05: report version times are in the firm’s time zone, not the browser’s', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/bookkeeping/reports`);
  await page.getByRole('button', { name: 'Actions for Profit & Loss' }).first().click();
  await page.getByRole('menuitem', { name: 'Figures & Versions' }).click();
  const dialog = page.getByTestId('figures-dialog');
  await expect(dialog.getByTestId('report-totals')).toBeVisible();
  const firmTimes = [0, 60_000].map((ms) =>
    new Date(Date.now() + ms).toLocaleTimeString('en-US', {
      timeZone: FIRM_ZONE,
      hour: 'numeric',
      minute: '2-digit',
    }),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Generate Version' }).click();
  const versions = dialog.getByTestId('report-versions');
  await expect(versions).toContainText('Version 1');
  const shown = clock(await versions.innerText());
  expect(firmTimes).toContain(shown);
});
