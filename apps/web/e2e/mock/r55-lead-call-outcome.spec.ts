import { expect, test } from '@playwright/test';

// R55, Leads Review 2 (row 7): with no calling integration, Call opens the phone and then asks how
// the call went. Log Call records the outcome and note on the lead's activity; Not Now logs
// nothing. Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000001`;

test('Call asks for the outcome; Log Call records it, Not Now records nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/activity`);
  const list = page.getByTestId('activity-list');
  await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
  const actions = page.getByRole('group', { name: 'Lead actions' });

  // Not Now: nothing is logged.
  await actions.getByRole('link', { name: 'Call' }).click();
  let dialog = page.getByTestId('call-outcome-dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Not Now' }).click();
  await expect(dialog).toBeHidden();
  await expect(list).not.toContainText('Call: ');

  // Log Call needs an outcome, then records it with the note.
  await actions.getByRole('link', { name: 'Call' }).click();
  dialog = page.getByTestId('call-outcome-dialog');
  await page.getByRole('button', { name: 'Log Call' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose how the call went.');
  await dialog.getByRole('radio', { name: 'No answer' }).check();
  await dialog.getByLabel('Note (optional)').fill('Try again Tuesday');
  await page.getByRole('button', { name: 'Log Call' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('lead-saved')).toHaveText(
    'Logged: Call: No answer. Try again Tuesday',
  );
  await expect(list).toContainText('Call: No answer. Try again Tuesday');
});
