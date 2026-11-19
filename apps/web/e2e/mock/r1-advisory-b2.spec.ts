import { expect, test } from '@playwright/test';

// R1, Business Advisory Review 2 batch B (the lead's list, A-xx). Mock mode as the Owner; the
// mock keeps its data in the page, so a test moves between pages by their links. Synthetic data
// only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test.describe.configure({ timeout: 240_000 });

test('A-NEW2: View History lists every client’s changes, filters by client and area, and opens each record', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory'));
  await page.getByRole('tab', { name: 'View History' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/business-advisory\/history$/, { timeout: 60_000 });
  const history = page.getByTestId('ba-history');
  const links = history.getByTestId('history-link');
  await expect(links.first()).toBeVisible({ timeout: 60_000 });
  // Every client's changes: more than one client is named.
  await expect(
    history.getByRole('cell', { name: 'Added to the advisory program' }),
  ).not.toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();
  await expect(history.getByRole('cell', { name: 'Advisory clients' }).first()).toBeVisible();

  // One area: plans only.
  await history.getByLabel('Area', { exact: true }).selectOption('PLAN');
  await expect(history.getByRole('cell', { name: 'Advisory clients' })).toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();

  // One client: theirs only.
  await history.getByLabel('Client', { exact: true }).selectOption(MARCUS);
  await expect(history.getByRole('cell', { name: 'Plan finalized' })).toBeVisible({
    timeout: 60_000,
  });
  // Their plan's three changes: started, finalized and sent.
  await expect(links).toHaveCount(3);

  // An entry opens its record: a plan change opens the client's plan.
  await history.getByRole('link', { name: 'Plan finalized' }).click();
  await expect(page).toHaveURL(new RegExp(`/business-advisory/clients/${MARCUS}/plan$`), {
    timeout: 60_000,
  });
});

test('A-X11: Edit Action Item opens the item’s form with its client fixed, and saves the changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/action-plans'));
  await page.getByLabel('Search action items').fill('Prepare funding', { timeout: 60_000 });
  await page
    .getByRole('button', { name: 'Actions for Prepare funding application' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Edit Action Item' }).click();
  const dialog = page.getByTestId('edit-action-item');
  const title = dialog.getByLabel(/^Action item/);
  await expect(title).toHaveValue('Prepare funding application');
  await expect(dialog.getByLabel(/^Advisory client/)).toBeDisabled();
  await expect(dialog.getByLabel(/^Priority/)).toHaveValue('HIGH');
  await title.fill('Prepare the SBA funding application');
  await dialog.getByLabel(/^Priority/).selectOption('NORMAL');
  await page.getByRole('button', { name: 'Save Action Item' }).click();
  await expect(
    page.getByText('Action item saved: Prepare the SBA funding application'),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Search action items').fill('SBA funding');
  await expect(page.getByRole('cell', { name: 'Prepare the SBA funding application' })).toBeVisible(
    { timeout: 60_000 },
  );
});

test('A-X11: Cancel Meeting on the client’s Meetings tab asks for a reason, then cancels the appointment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}/meetings`));
  const upcoming = page.getByTestId('tab-upcoming-meetings');
  await upcoming
    .getByRole('button', { name: 'Cancel the meeting: Strategy Review' })
    .click({ timeout: 60_000 });
  const dialog = page.getByTestId('cancel-meeting');
  await expect(dialog).toBeVisible();
  // The reason is required.
  await page.getByRole('button', { name: 'Cancel Meeting', exact: true }).click();
  await expect(dialog.getByText('Enter the reason for canceling')).toBeVisible();
  await dialog.getByLabel(/^Reason for canceling/).fill('The client asked to meet next month.');
  await page.getByRole('button', { name: 'Cancel Meeting', exact: true }).click();
  await expect(page.getByText(/^Meeting canceled: Strategy Review/)).toBeVisible({
    timeout: 60_000,
  });
  // The appointment is canceled, so it is no upcoming meeting any more.
  await expect(upcoming.getByText('Strategy Review')).toHaveCount(0, { timeout: 60_000 });
});
