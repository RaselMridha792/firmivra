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
