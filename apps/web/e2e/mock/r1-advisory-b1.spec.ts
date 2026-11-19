import { expect, test, type Page } from '@playwright/test';

// R1, Business Advisory Review 2 batch (the lead's list, A-xx): scheduling with the advisory
// type and the way back. Mock mode as the Owner; the mock keeps its data in the page, so a test
// moves between pages by their links. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test.describe.configure({ timeout: 240_000 });

/** The Appointment Type the form opened with. */
const chosenType = (page: Page) => page.getByLabel('Appointment Type *').locator('option:checked');

test('A-04: Schedule Advisory Meeting and the row menus open with the advisory type (and the row’s client in the link)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory'));
  await page.getByRole('link', { name: 'Schedule Advisory Meeting' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(
    /\/calendar\/new\?serviceKind=BUSINESS_DEVELOPMENT&from=%2Fbusiness-advisory$/,
    {
      timeout: 60_000,
    },
  );
  await expect(chosenType(page)).toHaveText('Business Advisory Meeting', { timeout: 60_000 });

  await page.goto(app('/business-advisory/clients'));
  await page
    .getByRole('button', { name: /^Actions for / })
    .first()
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Schedule Meeting' }).click();
  // The form opens on that client (the mock's clients list doesn't hold the advisory ones).
  await expect(page).toHaveURL(
    /\/calendar\/new\?clientId=[0-9a-f-]{36}&serviceKind=BUSINESS_DEVELOPMENT&from=%2Fbusiness-advisory%2Fclients$/,
  );
  await expect(chosenType(page)).toHaveText('Business Advisory Meeting', { timeout: 60_000 });
});

test('A-10/A-11: a client’s Schedule Meeting opens with the advisory type, and booking returns to their Meetings tab', async ({
  page,
}) => {
  // The mock's bookings are at a fixed -04:00 offset: "tomorrow" stays in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  // From the client's Meetings tab (the client header's Schedule Meeting is on every tab).
  await page.goto(app(`/business-advisory/clients/${MARCUS}/meetings`));
  await expect(page.getByTestId('meetings-schedule')).toBeVisible({ timeout: 60_000 });
  const schedule = page.getByTestId('schedule-meeting');
  await expect(schedule).toHaveAttribute('href', /clientId=[0-9a-f-]{36}&engagementId=/, {
    timeout: 60_000,
  });
  await schedule.click();
  await expect(chosenType(page)).toHaveText('Business Advisory Meeting', { timeout: 60_000 });
  // The mock's clients list doesn't hold the advisory clients: pick a contact to book.
  if (!(await page.getByLabel('Client / Lead *').inputValue())) {
    await page.getByLabel('Client / Lead *').fill('Nina');
    await page
      .getByTestId('contact-results')
      .getByRole('button', { name: /Nina Fairbanks/ })
      .click();
  }
  // Two weeks on: the mock's own bookings are all this week.
  await page.getByLabel('Date *').fill('2026-10-28');
  await page.getByLabel('Start Time *').selectOption('08:00');
  await page.getByLabel('End Time *').selectOption('09:00');
  await expect(page.getByTestId('no-conflicts')).toBeVisible();
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(app(`/business-advisory/clients/${MARCUS}/meetings`), {
    timeout: 120_000,
  });
  await expect(page.getByTestId('meetings-schedule')).toBeVisible({ timeout: 60_000 });
});

test('A-07: View Snapshot shows the whole finalized plan, read only', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/plans'));
  const list = page.getByTestId('ba-plans');
  await list
    .getByRole('button', { name: 'Actions for Fleet Expansion Plan' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Finalize Plan' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Fleet Expansion Plan finalized.')).toBeVisible();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Version History' }).click();
  await page.getByTestId('view-snapshot').first().click();
  const snapshot = page.getByTestId('plan-snapshot-full');
  for (const part of [
    'Business Profile',
    'Financial & Business Assessment',
    'Goals & Strategy',
    'Recommendations',
    'Services',
  ]) {
    await expect(snapshot.getByRole('region', { name: part, exact: true })).toBeVisible();
  }
  await expect(snapshot.getByRole('region', { name: 'Business Profile' })).toContainText(
    'Entity / industry',
  );
  // Nothing in it can be changed.
  await expect(snapshot.locator('input, textarea, select, button')).toHaveCount(0);
});

test('A-09: advisory reports keep the client and Advisory context, and their cards open their lists', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}`));
  await page.getByRole('button', { name: 'Generate Report' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Advisory Reports' }).click();
  await expect(page).toHaveURL(new RegExp(`/business-advisory/reports[?]client=${MARCUS}&from=`));
  await expect(page.getByTestId('report-client-context')).toContainText(
    'The counts below cover every advisory client.',
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('advisory-reports-library')).toHaveAttribute(
    'href',
    /^\/reports\/library\?category=ADVISORY&from=/,
  );
  await page.getByTestId('report-goals').getByRole('link', { name: 'Open Goals' }).click();
  await expect(page).toHaveURL(app('/business-advisory/goals'));
});

test('A-X01: a business client’s EIN status is kept apart from the number', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Acme Widgets LLC (fake): a Business with an EIN on file.
  await page.goto(app('/clients/0199b6a1-0000-7000-8000-000000000002'));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const status = page.getByLabel('EIN status');
  await expect(status).toHaveValue('HAS_EIN');
  await expect(page.getByLabel(/^New EIN/)).toBeEnabled();
  await status.selectOption('NOT_APPLICABLE');
  await expect(page.getByLabel(/^New EIN/)).toBeDisabled();
  // The mock's Acme lacks details the form requires of a Business: fill them (fake values).
  const fill = async (label: string, value: string) => {
    const f = page.getByLabel(label, { exact: true });
    if (!(await f.inputValue())) await f.fill(value);
  };
  await fill('Business phone *', '5550101234');
  await fill('Street address *', '1 Sample Way');
  await fill('City *', 'Atlanta');
  await fill('State *', 'GA');
  await fill('ZIP code *', '30301');
  await fill('Full name *', 'Avery Sample');
  await fill('Their email *', 'avery@example.test');
  await fill('Their phone *', '5550109876');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByLabel('EIN status')).toHaveValue('NOT_APPLICABLE');
  // Not Applicable keeps no number: nothing "ends" any more.
  await expect(page.getByLabel('New EIN', { exact: true })).toBeDisabled();
});

test('A-X04: the Recommendation field suggests the firm’s services and earlier recommendations, and takes a typed one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}/recommendations`));
  await page.getByRole('button', { name: 'Add Recommendation' }).first().click({ timeout: 60_000 });
  const dialog = page.getByTestId('add-recommendation');
  const options = dialog.getByTestId('recommendation-suggestions');
  // A service from Services & Pricing, and a recommendation the firm already made.
  await expect(options.locator('option[value="Growth Strategy"]')).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(options.locator('option[value="Implement Job Costing System"]')).toHaveCount(1);
  await dialog
    .getByLabel('Recommendation', { exact: true })
    .fill('Open a second operating account (fake)');
  await page.getByRole('button', { name: 'Add Recommendation' }).last().click();
  await expect(page.getByText('Open a second operating account (fake)').first()).toBeVisible();
});

test('A-X05: status changes and sharing ask first, in the app; Cancel changes nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/action-plans'));
  const recs = page.getByTestId('ba-recommendations');
  const actions = recs.getByRole('button', { name: 'Actions for Hire Operations Manager' });
  await actions.click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Accept' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept?' });
  await expect(dialog).toContainText('Hire Operations Manager moves from Proposed to Accepted.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Hire Operations Manager: accepted.')).toHaveCount(0);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Accept' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Hire Operations Manager: accepted.')).toBeVisible();
  // Showing it to the client is confirmed too.
  await actions.click();
  const share = page.getByRole('menuitem', { name: /on Client Portal|from Client Portal/ });
  await share.click();
  await expect(
    page.getByRole('dialog', { name: /to the client\?|from the client\?/ }),
  ).toBeVisible();
});

test('A-X12: notes show their audience, and the client’s own files have their own section', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}/notes`));
  await expect(page.getByTestId('note-audience')).toContainText('Internal · staff only', {
    timeout: 60_000,
  });
  // B32: a note's text reaches the client only through Share with Client, after a preview.
  await expect(page.getByTestId('note-audience')).toContainText(
    'Share with Client sends a note’s text to the client as a portal message',
  );

  await page.goto(app(`/business-advisory/clients/${MARCUS}/documents`));
  const files = page.getByTestId('files-from-client');
  await expect(files.getByRole('heading', { name: 'Files Shared by Client' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(files).toContainText(/No files from the client yet|Uploaded By/);
});

test('A-NEW1: a business client’s entity type is chosen from the list, with Other and Specify', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Acme Widgets LLC (fake): a Business.
  await page.goto(app('/clients/0199b6a1-0000-7000-8000-000000000002'));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const entity = page.getByLabel('Entity type', { exact: true });
  await expect(entity.locator('option')).toContainText([
    'Not set',
    'LLC',
    'S Corporation',
    'Other',
  ]);
  await expect(page.getByLabel('Specify entity type')).toHaveCount(0);
  await entity.selectOption('Other');
  await page.getByLabel('Specify entity type').fill('Holding company (fake)');
  const fill = async (label: string, value: string) => {
    const f = page.getByLabel(label, { exact: true });
    if (!(await f.inputValue())) await f.fill(value);
  };
  await fill('Business phone *', '5550101234');
  await fill('Street address *', '1 Sample Way');
  await fill('City *', 'Atlanta');
  await fill('State *', 'GA');
  await fill('ZIP code *', '30301');
  await fill('Full name *', 'Avery Sample');
  await fill('Their email *', 'avery@example.test');
  await fill('Their phone *', '5550109876');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Saved as the typed type: it opens as Other with its text.
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByLabel('Entity type', { exact: true })).toHaveValue('Other');
  await expect(page.getByLabel('Specify entity type')).toHaveValue('Holding company (fake)');
});

test('A-X13: Send Plan names who receives it and shows the text before anything is sent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/plans'));
  const list = page.getByTestId('ba-plans');
  await list
    .getByRole('button', { name: 'Actions for Fleet Expansion Plan' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Finalize Plan' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Fleet Expansion Plan finalized.')).toBeVisible();
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Send to Client' }).click();
  const preview = page.getByTestId('send-plan-preview');
  await expect(preview).toContainText('To:');
  await expect(preview).toContainText('Client portal');
  await preview.getByText('What the client receives').click();
  await expect(preview).toContainText('Your business plan: Fleet Expansion Plan');
  // A download reaches no one: the preview says so.
  await page.getByLabel('Send by').selectOption('DOWNLOAD');
  await expect(preview).toContainText('A download goes to no one');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('A-X08: Archive & History keeps archived and completed plans, with their versions and Restore', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/plans'));
  const list = page.getByTestId('ba-plans');
  await list
    .getByRole('button', { name: 'Actions for Fleet Expansion Plan' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Fleet Expansion Plan archived.')).toBeVisible();
  await expect(list.getByRole('row', { name: /Fleet Expansion Plan/ })).toHaveCount(0);

  const views = page.getByRole('tablist', { name: 'Business plan views' });
  await views.getByRole('tab', { name: 'Archive & History' }).click();
  await expect(
    list.getByRole('table', { name: 'Archived and completed business plans' }),
  ).toBeVisible();
  const row = list.getByRole('row', { name: /Fleet Expansion Plan/ });
  await expect(row).toBeVisible();
  await expect(list.getByRole('link', { name: 'Create Business Plan' })).toHaveCount(0);
  // A completed plan is kept here too, with its delivered version.
  await list.getByLabel('Kept plans').selectOption('COMPLETED');
  await expect(list.getByRole('row')).not.toHaveCount(1);
  await expect(list.getByRole('button', { name: 'v1' }).first()).toBeVisible();
  await list.getByRole('button', { name: 'v1' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Version 1');
  await page.keyboard.press('Escape');

  // Restore brings the archived plan back to the list.
  await list.getByLabel('Kept plans').selectOption('ARCHIVED');
  await list.getByRole('button', { name: 'Actions for Fleet Expansion Plan' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Fleet Expansion Plan restored.')).toBeVisible();
  await views.getByRole('tab', { name: 'Plans' }).click();
  await expect(list.getByRole('row', { name: /Fleet Expansion Plan/ })).toBeVisible();
});

test('A-X09: Correct opens a row’s period with its figures, needs a reason, and keeps the earlier row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/financial-analysis'));
  const section = page.getByTestId('ba-financials');
  const table = section.getByRole('table', { name: 'Financial snapshots' });
  await expect(table).toBeVisible({ timeout: 60_000 });
  await expect(table.getByRole('button', { name: /^Correct/ }).first()).toBeVisible();
  const rowsBefore = await table.getByRole('row').count();
  await table
    .getByRole('button', { name: /^Correct/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Correct Financial Figures' });
  await expect(dialog.getByLabel('Advisory client')).toBeDisabled();
  await expect(dialog.getByLabel('Period start')).toBeDisabled();
  await expect(dialog.getByLabel('Revenue ($)', { exact: true })).not.toHaveValue('');
  const original = Number(
    await dialog.getByLabel('Revenue ($)', { exact: true }).inputValue(),
  ).toLocaleString('en-US');
  const save = dialog.getByRole('button', { name: 'Save Correction' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Revenue ($)', { exact: true }).fill('123456');
  await dialog.getByLabel('Correction reason *').fill('Fake: a missed invoice');
  await save.click();
  await expect(
    page.getByText(/Figures corrected for .+\. The earlier figures are kept\./),
  ).toBeVisible();
  // The corrected figures replace the row; Show corrections lists the earlier one too.
  await expect(table.getByRole('row')).toHaveCount(rowsBefore);
  await expect(table).toContainText('$123,456');
  await expect(table).not.toContainText('$' + original);
  await section.getByLabel('Show corrections').check();
  await expect(table).toContainText('$' + original);
  await expect(table).toContainText('$123,456');
});

test('A-X06: an advisory client’s linked profiles, and Add Business or Personal Profile links a new client', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/clients'));
  await page.getByRole('button', { name: 'Add Advisory Client' }).click({ timeout: 60_000 });
  const add = page.getByRole('dialog', { name: 'Add Advisory Client' });
  await add
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await add.getByLabel('Primary service focus').selectOption({ index: 1 });
  await add.getByRole('button', { name: 'Add Client' }).click();

  const section = page.getByTestId('advisory-linked-profiles');
  await expect(section.getByText('Linked Profiles')).toBeVisible({ timeout: 60_000 });
  await section.getByRole('button', { name: 'Add Business or Personal Profile' }).click();
  const role = page.getByRole('dialog', { name: 'Add Business or Personal Profile' });
  await expect(role.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await role.getByLabel('How they are related *').selectOption('OWNER');
  await role.getByRole('button', { name: 'Continue' }).click();

  const form = page.getByRole('dialog', { name: 'Add New Client' });
  await form.getByLabel('Full name *').fill('Avery Owner (fake)');
  await form.getByLabel('Email *').fill('avery.owner@example.test');
  await form.getByLabel('Phone *').fill('4045550177');
  await form.getByLabel('Street address *').fill('1 Sample Way');
  await form.getByLabel('City *').fill('Atlanta');
  await form.getByLabel('State *').selectOption('GA');
  await form.getByLabel('ZIP code *').fill('30301');
  await form.getByRole('button', { name: 'Add Client' }).click();

  await expect(section.getByRole('status')).toContainText(
    'Avery Owner (fake) was added and linked to Acme Widgets LLC (fake).',
  );
  const link = section.getByTestId('client-link-row').filter({ hasText: 'Avery Owner (fake)' });
  await expect(link).toContainText('Owner');
  await expect(link).toContainText('Personal');
});
