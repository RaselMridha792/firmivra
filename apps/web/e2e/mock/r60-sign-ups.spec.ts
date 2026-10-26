import { expect, type Page, test } from '@playwright/test';

// Octavia's Client Sign-ups (spec of Oct 25, D1), in mock mode as the Owner. The mock
// (src/mocks/client-auth.ts) has four waiting requests (Sam Poe, Jane Roe, John Doe, Lee Roe,
// newest first; all but John may be existing clients), one approved and one declined. Fake data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const rows = (page: Page) => page.getByTestId('sign-up-row');
const names = (page: Page) => rows(page).getByRole('button', { name: /^Review / });
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });
const panel = (page: Page) => page.getByTestId('sign-up-panel');

async function open(page: Page, path = '/sign-ups') {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(path));
  await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
}

test('F01, F02: the Clients group opens Sign-ups; each tab lists its own, with the firm counts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  await nav.getByRole('link', { name: 'Sign-ups', exact: true }).click();
  await expect(page).toHaveURL(app('/sign-ups'));
  await expect(nav.getByRole('link', { name: 'Sign-ups', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const waiting = tab(page, /^Waiting for Approval/);
  await expect(waiting).toHaveAttribute('aria-selected', 'true');
  await expect(waiting).toContainText('4', { timeout: 60_000 });
  await expect(tab(page, /^Approved/)).toContainText('1');
  await expect(tab(page, /^Declined/)).toContainText('1');
  await expect(names(page)).toHaveText([/Sam Poe/, /Jane Roe/, /John Doe/, /Lee Roe/]);
  // The check is words, not a colour only.
  await expect(rows(page).filter({ hasText: 'John Doe' })).toContainText('No match found');
  await expect(rows(page).filter({ hasText: 'Potential match' })).toHaveCount(3);
  await expect(page.getByTestId('sign-ups-total')).toHaveText('4 waiting requests');

  // Arrow keys move along the tabs.
  await waiting.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, /^Approved/)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(app('/sign-ups?tab=approved'));
  await expect(names(page)).toHaveText([/Kim Doe/]);
  await expect(rows(page)).toContainText('CL-10006');
  await tab(page, /^Declined/).click();
  await expect(names(page)).toHaveText([/Alex Moe/]);
  await expect(rows(page)).toContainText('Declined');
});

test('F03 and Back: search, filters, sort and the open request come back after a client record', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('searchbox', { name: 'Search name or email' }).fill('roe');
  await expect(names(page)).toHaveText([/Jane Roe/, /Lee Roe/]);
  // The tab still counts the firm's requests; the result line says what matched.
  await expect(tab(page, /^Waiting for Approval/)).toContainText('4');
  await expect(page.getByTestId('sign-ups-total')).toHaveText(
    '2 matching requests · 4 waiting in total',
  );

  await page.getByRole('button', { name: 'Filters' }).click();
  const filters = page.getByRole('form', { name: 'Filters' });
  await filters.getByLabel('Match check').selectOption('POTENTIAL_MATCH');
  await filters.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('list', { name: 'Current filters' })).toContainText(
    'Potential match',
  );
  await page.getByTestId('sign-ups-sort').selectOption('oldest');
  await expect(names(page)).toHaveText([/Lee Roe/, /Jane Roe/]);

  await page.getByRole('button', { name: "Review Jane Roe's request" }).click();
  await expect(panel(page)).toContainText('Resolve Existing Account');
  await expect(page).toHaveURL(/search=roe&sort=oldest&match=potential&request=/);
  const place = page.url();

  await panel(page)
    .getByRole('link', { name: /View existing client record/ })
    .click();
  await expect(page).toHaveURL(/\/clients\/00000000-0000-4000-a000-000000000402$/, {
    timeout: 60_000,
  });
  await page.goBack();
  await expect(page).toHaveURL(place);
  await expect(page.getByRole('searchbox', { name: 'Search name or email' })).toHaveValue('roe');
  await expect(names(page)).toHaveText([/Lee Roe/, /Jane Roe/]);
  await expect(panel(page)).toContainText('Jane Roe');

  // Nothing matches: the query stays, with Clear; Clear brings every waiting request back.
  await page.getByRole('searchbox', { name: 'Search name or email' }).fill('nobody here');
  await expect(page.getByTestId('sign-ups-empty')).toContainText('No waiting requests match');
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(names(page)).toHaveCount(4);
  await expect(page).toHaveURL(/\/sign-ups\?sort=oldest&request=/);
});

test('a filter range that ends before it starts is refused in the form', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Filters' }).click();
  const filters = page.getByRole('form', { name: 'Filters' });
  await filters.getByLabel('From').fill('2026-10-08');
  await filters.getByLabel('To').fill('2026-10-01');
  await filters.getByRole('button', { name: 'Apply' }).click();
  await expect(filters).toContainText('The start date is after the end date.');
  await expect(filters.getByLabel('From')).toBeFocused();
  // Escape leaves the filters as they were.
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
  await expect(names(page)).toHaveCount(4);
});

test('F07, F08, F11: a potential match keeps Approve off; Keep Pending changes nothing', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: "Review Lee Roe's request" }).click();
  const p = panel(page);
  await expect(p.getByTestId('match-alert')).toContainText(
    'Potential Match — Automatic Approval Paused',
  );
  // Matched on the phone number; the candidate shows its Client ID and name only.
  await expect(p).toContainText('CL-10005 · Lee Roe · same phone number');
  await expect(p.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Decline' })).toBeEnabled();
  for (const name of ['Restore Access', 'Link Existing Record']) {
    await expect(p.getByRole('button', { name })).toBeDisabled();
  }
  for (const name of [
    'Call the contact already on file',
    "Verify the client's identity",
    "Record the client's permission",
  ]) {
    await expect(p.getByRole('checkbox', { name })).toBeDisabled();
  }
  await expect(page.getByTestId('sign-up-activity')).toContainText('Application submitted');

  await p.getByRole('button', { name: 'Keep Pending' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    "Lee Roe's request stays waiting for approval. Nothing was changed.",
  );
  await expect(panel(page)).toContainText('Select a request');
  await expect(tab(page, /^Waiting for Approval/)).toContainText('4');
});

test('F14: the client view preview offers only Sign In, Reset Password and Contact Firm', async ({
  page,
}) => {
  await open(page);
  const preview = page.getByTestId('client-view-preview');
  await expect(preview.getByRole('link')).toHaveText([/Sign In/, /Reset Password/, /Contact Firm/]);
  await expect(preview.getByRole('button')).toHaveCount(0);
  const hrefs = await preview
    .getByRole('link')
    .evaluateAll((links) => links.map((l) => [l.getAttribute('href'), l.getAttribute('target')]));
  expect(hrefs.map(([href]) => href?.replace(/^.*?\/lvp/, '/lvp'))).toEqual([
    '/lvp/sign-in',
    '/lvp/forgot-password',
    '/lvp',
  ]);
  expect(hrefs.every(([, target]) => target === '_blank')).toBe(true);
});

test('S11: Manage settings names the firm and both modes; Cancel changes nothing, Confirm once', async ({
  page,
}) => {
  await open(page);
  const card = page.getByTestId('approval-card');
  const modes = card.getByRole('list', { name: 'Approval mode' });
  await expect(modes).toContainText("Manual Review(your firm's mode now)");
  await card.getByRole('button', { name: 'Manage settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Change how LVP Accounting & Taxes approves sign-ups?',
  });
  await expect(dialog.getByRole('button', { name: 'Confirm change' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Automatic Approval' }).check();
  await expect(dialog).toContainText('Current modeManual Review');
  await expect(dialog).toContainText('Requested modeAutomatic Approval');
  await expect(dialog).toContainText('Requests already waiting stay waiting');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(modes).toContainText("Manual Review(your firm's mode now)");

  await card.getByRole('button', { name: 'Manage settings' }).click();
  await dialog.getByRole('radio', { name: 'Automatic Approval' }).check();
  await dialog.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    'New sign-ups now use Automatic Approval.',
  );
  await expect(modes).toContainText("Automatic Approval(your firm's mode now)");
  // A mode change approves nothing already waiting.
  await expect(tab(page, /^Waiting for Approval/)).toContainText('4');
});

test('no horizontal scroll at 1440 and 375 px, with a request open', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app('/sign-ups?request=00000000-0000-4000-a000-000000000302'));
    await expect(panel(page)).toContainText('Jane Roe', { timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
