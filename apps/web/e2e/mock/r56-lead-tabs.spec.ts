import { expect, test } from '@playwright/test';

// R56 part 2: the Lead Profile tabs under /leads/[id] in mock mode (playwright.mock.config.ts runs
// every module on mock data as an Owner). The first mock lead has open tasks and no appointments.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000001`;

test('every tab keeps the header and the tab bar', async ({ page }) => {
  for (const tab of [
    'communications',
    'appointments',
    'tasks',
    'documents',
    'campaigns',
    'notes',
    'activity',
  ]) {
    await page.goto(`${lead}/${tab}`);
    await expect(page.getByTestId('lead-name')).toHaveText(/\S+ \S+/);
    await expect(page.getByText('Lead ID: LD-')).toBeVisible();
    const bar = page.getByRole('navigation', { name: 'Lead profile' });
    await expect(bar.getByRole('link')).toHaveCount(9);
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByTestId(`lead-tab-${tab}`)).toBeVisible();
  }
  // The tab bar moves between the tabs and back to the overview.
  await page.goto(`${lead}/notes`);
  await page
    .getByRole('navigation', { name: 'Lead profile' })
    .getByRole('link', { name: 'Tasks' })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page
    .getByRole('navigation', { name: 'Lead profile' })
    .getByRole('link', { name: 'Overview' })
    .click();
  await expect(page).toHaveURL(/\/leads\/0199c0c0-0a00-7000-8000-000000000001$/);
});

test('Communications: filters, logs a call and opens the email composer', async ({ page }) => {
  await page.goto(`${lead}/communications`);
  await expect(page.getByTestId('card-communications')).toBeVisible();
  await page.getByRole('button', { name: 'Log Call or Contact' }).click();
  await page.getByLabel('What happened').fill('Left a voicemail about the 2025 return.');
  await page.getByRole('button', { name: 'Log activity', exact: true }).click();
  await expect(page.getByTestId('activity-list')).toContainText('voicemail');
  await page.getByRole('button', { name: 'Emails', exact: true }).click();
  await expect(page.getByTestId('activity-list')).not.toContainText('voicemail');
  await page.getByRole('button', { name: 'Send Email' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Appointments: the Upcoming Appointments card and the scheduling dialog', async ({ page }) => {
  await page.goto(`${lead}/appointments`);
  await expect(page.getByTestId('card-upcoming-appointments')).toBeVisible();
  await expect(page.getByTestId('card-past-appointments')).toBeVisible();
  await page
    .getByTestId('card-upcoming-appointments')
    .getByRole('button', { name: 'Schedule Appointment' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Tasks: the open tasks and a saved follow-up', async ({ page }) => {
  await page.goto(`${lead}/tasks`);
  await expect(page.getByTestId('lead-task-list').getByRole('listitem').first()).toBeVisible();
  await page.getByLabel('Action Type').selectOption('EMAIL');
  await page.locator('#fu-date').fill('2027-03-02');
  await page.getByRole('button', { name: 'Save Follow-Up' }).click();
  await expect(page.getByText('Follow-up saved.')).toBeVisible();
  await expect(page.getByTestId('card-follow-up')).toContainText('Email');
});

test('Documents & Forms: both cards keep their frame', async ({ page }) => {
  await page.goto(`${lead}/documents`);
  await expect(page.getByTestId('card-documents')).toBeVisible();
  await expect(page.getByTestId('card-forms')).toBeVisible();
});

test('Campaigns: source, campaign and tags', async ({ page }) => {
  await page.goto(`${lead}/campaigns`);
  await expect(page.getByTestId('card-campaign')).toContainText('Lead Source');
  await expect(page.getByTestId('card-tags')).toBeVisible();
});

test('Notes: adds a note and shows it first', async ({ page }) => {
  await page.goto(`${lead}/notes`);
  await page.getByLabel('Add a note (only your firm sees it)').fill('Prefers evening calls.');
  await page.getByRole('button', { name: 'Save Note' }).click();
  await expect(page.getByTestId('lead-notes').getByRole('listitem').first()).toContainText(
    'Prefers evening calls.',
  );
});

test('Activity: the history and Log Activity', async ({ page }) => {
  await page.goto(`${lead}/activity`);
  await expect(page.getByTestId('activity-list').getByRole('listitem').first()).toBeVisible();
  await page.getByRole('button', { name: 'Log Activity' }).click();
  await page.getByLabel('Type').selectOption('MEETING');
  await page.getByLabel('What happened').fill('Met at the open house.');
  await page.getByRole('button', { name: 'Log activity', exact: true }).click();
  await expect(page.getByTestId('activity-list')).toContainText('Met at the open house.');
});

test('No sideways scroll at 375 px on any tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of [
    'communications',
    'appointments',
    'tasks',
    'documents',
    'campaigns',
    'notes',
    'activity',
  ]) {
    await page.goto(`${lead}/${tab}`);
    await expect(page.getByTestId(`lead-tab-${tab}`)).toBeVisible();
    await page.waitForTimeout(600);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, tab).toBeLessThanOrEqual(1);
  }
});
