// R60, Staff Management Review 2 (Nov 17 review; the lead's decisions of Nov 18). Mock mode, as an
// Owner. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('SM01: the Reports tile opens the Staff & Team report with its content, and Back returns to Staff Management', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team'));
  await page
    .getByTestId('staff-links')
    .getByRole('link', { name: /^Reports/ })
    .click();
  await expect(page).toHaveURL(app('/reports/staff_team?from=%2Fteam'), { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Staff & Team', level: 1 })).toBeVisible();
  await expect(page.getByTestId('report-table')).toContainText('Alex Rivera');
  await expect(page.getByTestId('report-back')).toHaveText('← Back to Staff Management');
  await page.getByTestId('report-back').click();
  await expect(page).toHaveURL(app('/team'));
});

test('SM04: Create Staff’s permission grid has the Export column, set like any other', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new/permissions'));
  await page.getByLabel('Select a Role *').selectOption({ label: 'Tax Preparer' });
  const exportClients = page.getByRole('checkbox', { name: 'Clients: Export' });
  await expect(exportClients).toBeVisible({ timeout: 60_000 });
  await exportClients.check();
  await expect(exportClients).toBeChecked();
});

const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('SM18: Edit Staff asks before unsaved changes are lost: Keep Editing, Discard Changes or Save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/team/${HANA}`));
  await expect(page.getByLabel('First Name *')).toHaveValue('Hana', { timeout: 60_000 });
  await page.getByLabel('Job Title *').fill('Synthetic title change');
  // Cancel asks; Keep Editing stays with the change.
  await page.getByRole('link', { name: 'Cancel' }).click();
  const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(page).toHaveURL(app(`/team/${HANA}`));
  await expect(page.getByLabel('Job Title *')).toHaveValue('Synthetic title change');
  // The sidebar asks too; Discard Changes leaves without saving.
  await page.getByTestId('sidebar-menu').getByRole('link', { name: 'Leads' }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page).toHaveURL(app('/leads'), { timeout: 60_000 });
});

test('SM18: Create Staff asks before leaving unsaved work, and Save Draft keeps it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  await page.getByLabel('First Name *').fill('Fake');
  await page.getByLabel('Last Name *').fill('Draftguard');
  await page.getByRole('link', { name: 'Cancel' }).click();
  const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page).toHaveURL(app('/team'), { timeout: 60_000 });
  // Nothing unsaved: leaving asks nothing.
  await page.goto(app('/team/new'));
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(app('/team'), { timeout: 60_000 });
});

test('SM16: each Create Staff step says the progress is kept as a draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  await expect(page.getByTestId('autosave-note')).toHaveText(
    'Next saves your progress as a draft.',
    { timeout: 60_000 },
  );
  await page.goto(app('/team/new/permissions'));
  await expect(page.getByTestId('autosave-note')).toHaveText(
    'Progress saved as a draft. Back and Next save this step too.',
    { timeout: 60_000 },
  );
});

test.describe('SM38: Staff Management times are in the firm’s time zone', () => {
  // The browser in Dhaka, the firm (mock) in New York: a time in the wrong zone is 10 to 11 hours off.
  test.use({ timezoneId: 'Asia/Dhaka' });

  test('the security defaults’ Last saved time is the firm’s', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(app('/team/settings/security'));
    await page.getByLabel('Set automatic logout after inactivity').check({ timeout: 60_000 });
    const clock = (d: Date) =>
      /\d{1,2}:\d{2}/.exec(
        d.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
        }),
      )?.[0];
    const expected = [clock(new Date()), clock(new Date(Date.now() + 60_000))];
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page
      .getByRole('dialog', { name: 'Save the new account defaults?' })
      .getByRole('button', { name: 'Save Defaults' })
      .click();
    await expect(page.getByTestId('defaults-saved')).toBeVisible();
    const saved = await page
      .getByText(/by Morgan Avery/)
      .first()
      .innerText();
    expect(expected).toContain(/\d{1,2}:\d{2}/.exec(saved)?.[0]);
  });
});
