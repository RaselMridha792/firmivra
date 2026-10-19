import { expect, test } from '@playwright/test';

// R0: Business Advisory & Development in mock mode (every module on mock data, as an Owner): seven
// live advisory clients, five upcoming meetings, ten goals and the resource library.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/business-advisory`;

test('Overview: header, four KPIs, eight tabs, quick actions, clients, meetings, goals and resources', async ({
  page,
}) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Business Advisory & Development', level: 1 }),
  ).toBeVisible();
  const kpis = page.getByTestId('ba-kpis');
  await expect(kpis.getByRole('listitem')).toHaveCount(4);
  await expect(kpis).toContainText('Active Advisory Clients');
  await expect(kpis).toContainText('Growth Action Plans In Progress');
  await expect(
    page.getByRole('tablist', { name: 'Business advisory views' }).getByRole('tab'),
  ).toHaveCount(8);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const actions = page.getByTestId('quick-actions');
  await expect(actions.getByRole('link', { name: 'Create Business Plan' })).toHaveAttribute(
    'href',
    '/business-advisory/plans/new',
  );
  await expect(actions.getByRole('link', { name: 'Schedule Advisory Meeting' })).toBeVisible();
  await expect(actions.getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('recent-clients').getByTestId('client-link')).toHaveCount(5);
  await expect(page.getByTestId('recent-clients')).toContainText('Taylor Construction LLC');
  const meetings = page.getByTestId('meetings');
  await expect(meetings.getByRole('link', { name: /^Join the meeting/ })).toHaveCount(4);
  await expect(meetings.getByRole('link', { name: /^Open the meeting/ })).toHaveCount(1);
  await expect(page.getByTestId('goals').getByRole('progressbar')).toHaveCount(5);
  await expect(page.getByTestId('goals')).toContainText('Overdue');
  await expect(page.getByTestId('resources').getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('resources')).toContainText('Business Formation Checklist');
});

test('Row actions: open the advisory detail, and add a goal for that client', async ({ page }) => {
  await page.goto(base);
  const recent = page.getByTestId('recent-clients');
  await recent.getByRole('button', { name: 'Actions for Marcus Taylor' }).click();
  await expect(page.getByRole('menuitem', { name: 'Create Business Plan' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add Business Goal' }).click();
  const dialog = page.getByTestId('add-goal');
  await expect(dialog.getByLabel('Advisory client')).not.toHaveValue('');
  await dialog.getByLabel('Goal', { exact: true }).fill('Open a second yard');
  await dialog.getByLabel('Area').selectOption('EXPANSION');
  await dialog.getByRole('button', { name: 'Add milestone' }).click();
  await dialog.getByRole('textbox', { name: 'Milestone 1' }).fill('Sign the lease');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Goal' }).click();
  await expect(page.getByText('Goal added: Open a second yard')).toBeVisible();

  await recent.getByRole('button', { name: 'Actions for Marcus Taylor' }).click();
  await page.getByRole('menuitem', { name: 'Open Advisory Detail' }).click();
  await expect(page).toHaveURL(/\/business-advisory\/clients\/[0-9a-f-]{36}$/, {
    timeout: 60_000,
  });
});

test('Add Advisory Client: a firm client joins with a service focus; adding twice is refused', async ({
  page,
}) => {
  await page.goto(base);
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Add Advisory Client' })
    .click();
  const dialog = page.getByTestId('add-advisory-client');
  await dialog
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await dialog.getByLabel('Primary service focus').selectOption({ label: 'Business Planning' });
  await dialog.getByRole('checkbox', { name: 'Financial Analysis' }).click();
  await dialog.getByLabel('Business stage').selectOption('Growth');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Client' }).click();
  await expect(page).toHaveURL(/\/business-advisory\/clients\/[0-9a-f-]{36}$/, {
    timeout: 60_000,
  });

  await page.goBack();
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Add Advisory Client' })
    .click();
  await dialog
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await dialog.getByLabel('Primary service focus').selectOption({ label: 'Business Planning' });
  await page.getByRole('dialog').getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByRole('alert')).toContainText('in the advisory program already');
});
