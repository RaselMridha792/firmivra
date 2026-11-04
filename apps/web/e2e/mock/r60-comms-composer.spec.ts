import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review, the composer (playwright.mock.config.ts, as an
// Owner; the mock answers as the API): CM-F05 an announcement's audience, CM-F06 Back with unsaved
// changes, CM-F07 the last save, CM-F09 the real reason on the real field.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

const start = async (page: Page, channel: 'EMAIL' | 'ANNOUNCEMENT') => {
  await page.goto(`${base}/new?channel=${channel}`);
  // Nothing is made until Start (Octavia's Q3).
  await page.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByTestId('composer')).toBeVisible();
};

test('CM-F05: an announcement chooses its clients below the window; only portal users count', async ({
  page,
}) => {
  await start(page, 'ANNOUNCEMENT');
  const form = page.getByTestId('composer-form');
  const window = form.getByTestId('announcement-window');
  const recipients = form.getByTestId('recipients-field');
  await expect(recipients).toBeVisible();
  // Below Show From and Show Until: placement and audience are separate.
  const [w, r] = await Promise.all([window.boundingBox(), recipients.boundingBox()]);
  expect(r!.y).toBeGreaterThan(w!.y + w!.height - 1);
  await expect(page.getByTestId('checklist')).toContainText('Choose recipients first.');

  await recipients.getByRole('button', { name: 'Choose Recipients' }).click();
  const modal = page.getByTestId('recipients-modal');
  await expect(modal).toBeVisible();
  // Leads have no portal: no Leads group, and a client without a portal login cannot be chosen.
  await expect(modal.getByRole('button', { name: 'Leads', exact: true })).toHaveCount(0);
  await modal.getByRole('button', { name: 'All Contacts' }).click();
  const list = modal.getByTestId('candidates');
  await expect(list.getByText('No portal access').first()).toBeVisible();
  const enabled = list.getByRole('checkbox', { disabled: false });
  await enabled.first().check();
  await enabled.nth(1).check();
  await page.getByRole('button', { name: 'Apply 2 Recipients' }).click();
  await expect(recipients.getByTestId('audience-count')).toHaveText(
    '2 can receive this announcement',
  );
  await expect(page.getByTestId('checklist')).not.toContainText('Choose recipients first.');
});

test('CM-F06, F07: Back with unsaved changes asks; Keep Editing, Discard and Save Draft', async ({
  page,
}) => {
  await start(page, 'EMAIL');
  const state = page.getByTestId('save-state');
  // The firm's time zone (America/New_York in the mock), whatever the browser's.
  await expect(state).toContainText(/Last saved \w{3} \d+, \d+:\d{2}\s[AP]M\sE[SD]T/);
  const name = page.getByLabel('Campaign Name');
  const original = await name.inputValue();
  const back = page.getByRole('link', { name: 'Back to Communications' });

  await name.fill('Spring newsletter (draft)');
  await expect(state).toHaveText('Unsaved changes');
  await back.click();
  const ask = page.getByRole('dialog', { name: 'Save your changes?' });
  await ask.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(name).toHaveValue('Spring newsletter (draft)');

  // Discard leaves without the change; what was saved before stays. (The mock keeps its data in
  // the tab, so the way back is the browser's Back, not a reload.)
  await back.click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(base);
  await page.goBack();
  await expect(name).toHaveValue(original);

  // Save Draft keeps it, then leaves.
  await name.fill('Spring newsletter (kept)');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await ask.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page).toHaveURL(base);
  await page.goBack();
  await expect(name).toHaveValue('Spring newsletter (kept)');
  await expect(state).toContainText('Last saved');

  // Nothing unsaved: Back goes at once.
  await back.click();
  await expect(page).toHaveURL(base);
});

test('CM-F09: a window that ends before it starts is shown on Show Until, and nothing is lost', async ({
  page,
}) => {
  await start(page, 'ANNOUNCEMENT');
  await page.getByLabel('Title').fill('Office closed Friday');
  await page.getByLabel('Show From').fill('2030-03-08T10:00');
  const until = page.getByLabel('Show Until');
  await until.fill('2030-03-08T09:00');
  await expect(until).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Show Until must be after Show From.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save Draft' }).first().click();
  await expect(page.getByTestId('save-state')).toHaveText(
    'Not saved: Show Until must be after Show From.',
  );
  await expect(page.getByLabel('Title')).toHaveValue('Office closed Friday');

  await until.fill('2030-03-08T18:00');
  await expect(until).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Save Draft' }).first().click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page.getByTestId('save-state')).toContainText('Last saved');
});
