import { expect, test } from '@playwright/test';

// R56, Appointments D4 (found in a live sweep): "Settings saved." could flash by unseen. A save
// that changes a value reloads the type's settings, and the form is drawn again from them (it is
// keyed by them); the message lived in the form and went with it as soon as the reload came
// back. It is now kept by the settings panel and stays after the redraw. The mock answers after
// 250 ms, so the old form is waited out (detached) before the message is read.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('D4: "Settings saved." stays after the saved settings come back and the form is drawn again', async ({
  page,
}) => {
  await page.goto(app('/calendar/types'));
  // The first active type's settings open with the page.
  const settings = page.getByTestId('type-settings');
  const windowSel = settings.getByLabel('Booking window');
  await expect(windowSel).toBeVisible({ timeout: 60_000 });
  const saved = page.getByTestId('type-settings-saved');
  const save = settings.getByRole('button', { name: 'Save Settings' });
  const form = save.locator('xpath=ancestor::form[1]');

  for (const label of ['6 hours ahead', '12 hours ahead']) {
    const before = await form.elementHandle();
    await windowSel.selectOption({ label });
    await save.click();
    // The form drawn from the reloaded settings replaces this one.
    await before!.waitForElementState('hidden');
    await expect(windowSel.locator('option:checked')).toHaveText(label);
    await expect(saved).toHaveText('Settings saved.');
  }
});
