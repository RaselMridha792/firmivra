import { expect, type Page, test } from '@playwright/test';

// Tax Planning Review 2, approved addition "Project Deadlines", in mock mode
// (playwright.mock.config.ts, signed in as Mock User, the Owner). The mock (mocks/project-deadlines.ts)
// has Mock User's private deadline, one Mock User shares with Sam Staff, and one Sam Staff shares
// with Mock User.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const MINE = 'Finish the 2027 planning projections';
const SHARED_BY_ME = 'Send the plan for internal review';
const SHARED_WITH_ME = 'Collect the estimated payment records';

const rowOf = (page: Page, name: string) =>
  page.getByTestId('project-deadlines').getByRole('row').filter({ hasText: name });
const menuOf = (page: Page, name: string) =>
  page.getByRole('button', { name: `Actions for ${name}` }).click();

test('Project Deadlines sits beside Reports and shows each deadline’s owner and visibility', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-planning/deadlines'));
  const tabs = page.getByRole('tablist', { name: 'Tax planning views' }).getByRole('tab');
  await expect(tabs).toHaveText([
    'Overview',
    'Clients',
    'Planning Opportunities',
    'Strategies & Recommendations',
    'Tax Calendar',
    'Resources',
    'Reports',
    'Project Deadlines',
  ]);
  await expect(tabs.filter({ hasText: 'Project Deadlines' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const mine = rowOf(page, MINE);
  await expect(mine).toContainText('You');
  await expect(mine).toContainText('Private');
  await expect(mine).toContainText('1 day before; 2 hours before');
  const sharedByMe = rowOf(page, SHARED_BY_ME);
  await expect(sharedByMe).toContainText('Shared');
  await expect(sharedByMe.getByTestId('deadline-shared')).toContainText('Sam Staff');
  await expect(rowOf(page, SHARED_WITH_ME)).toContainText('Sam Staff');
  await page.screenshot({ path: testInfo.outputPath('deadlines-1440.png'), fullPage: true });

  await page.getByRole('combobox', { name: 'Show' }).selectOption('mine');
  await expect(rowOf(page, SHARED_WITH_ME)).toHaveCount(0);
  await expect(rowOf(page, MINE)).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Show' }).selectOption('shared');
  await expect(rowOf(page, MINE)).toHaveCount(0);
  await expect(rowOf(page, SHARED_WITH_ME)).toHaveCount(1);

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('deadlines-375.png'), fullPage: true });
});

test('Add Deadline takes a name, date and time, description, service, client, coworkers and several reminders', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/tax-planning/deadlines'));
  await page.getByRole('button', { name: 'Add Deadline' }).click();
  const form = page.getByTestId('deadline-form');
  await form.getByLabel('Deadline name').fill('Prepare the year-end planning memo');
  await form.getByLabel('Due date').fill('2030-12-15');
  await form.getByLabel('Due time').fill('15:30');
  await form.getByLabel('Description (optional)').fill('Fake: summarise the open strategies.');

  // A service is required.
  await form.getByRole('button', { name: 'Add Deadline' }).click();
  await expect(form.getByTestId('deadline-form-error')).toHaveText('Choose a service.');

  await form.getByLabel('Service').selectOption({ label: 'Tax Planning' });
  await form.getByLabel('Client (optional)').selectOption({ label: 'Jamie Sample' });
  // Private until shared; sharing names the coworkers.
  await expect(form.getByRole('radio', { name: 'Private: only me' })).toBeChecked();
  await form.getByRole('radio', { name: 'Shared with chosen coworkers' }).check();
  await form.getByRole('checkbox', { name: 'Sam Staff' }).check();
  // A second reminder, two hours before, by email too.
  await form.getByRole('button', { name: 'Add Reminder' }).click();
  await form.getByLabel('Reminder 2 amount').fill('2');
  await form.getByLabel('Reminder 2 unit').selectOption('HOURS');
  await form
    .getByTestId('deadline-reminders')
    .getByRole('checkbox', { name: 'Email' })
    .nth(1)
    .check();
  await page.screenshot({ path: testInfo.outputPath('add-deadline.png'), fullPage: true });
  await form.getByRole('button', { name: 'Add Deadline' }).click();

  await expect(page.getByTestId('deadlines-result')).toHaveText(
    'Prepare the year-end planning memo is added.',
  );
  const row = rowOf(page, 'Prepare the year-end planning memo');
  await expect(row).toContainText('Tax Planning');
  await expect(row).toContainText('Jamie Sample');
  await expect(row.getByTestId('deadline-shared')).toContainText('Sam Staff');
  await expect(row).toContainText('1 day before; 2 hours before');
  await expect(row).toContainText('You');
});

test('only the owner edits or deletes; a coworker it is shared with completes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-planning/deadlines'));

  // Sam Staff's deadline, shared with Mock User: no Edit or Delete, but Mark Complete.
  await menuOf(page, SHARED_WITH_ME);
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Mark Complete' }).click();
  await expect(page.getByTestId('deadlines-result')).toHaveText(`${SHARED_WITH_ME} is complete.`);
  await expect(rowOf(page, SHARED_WITH_ME)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Status' }).selectOption('completed');
  await expect(rowOf(page, SHARED_WITH_ME)).toContainText('Completed');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('open');

  // The owner's own: Edit keeps everything it does not change, and Delete asks first.
  await menuOf(page, MINE);
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const form = page.getByTestId('deadline-form');
  await expect(form.getByLabel('Service')).toHaveValue('0199c0e0-0a00-7000-8000-000000000004');
  await expect(form.getByLabel('Reminder 1 amount')).toHaveValue('1');
  await expect(form.getByLabel('Reminder 2 unit')).toHaveValue('HOURS');
  await form.getByLabel('Deadline name').fill('Finish the 2027 projections');
  await form.getByRole('button', { name: 'Save Deadline' }).click();
  await expect(page.getByTestId('deadlines-result')).toHaveText(
    'Finish the 2027 projections is saved.',
  );
  await expect(rowOf(page, 'Finish the 2027 projections')).toContainText('Private');

  await menuOf(page, 'Finish the 2027 projections');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this deadline?' })
    .getByRole('button', {
      name: 'Delete Deadline',
    })
    .click();
  await expect(page.getByTestId('deadlines-result')).toHaveText(
    'Finish the 2027 projections is deleted.',
  );
  await expect(rowOf(page, 'Finish the 2027 projections')).toHaveCount(0);
});
