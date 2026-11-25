import { expect, test, type Page } from '@playwright/test';

// #56 Settings C (Review One), Workflow & Automations hub, on Appointments > Manage Appointment
// Types (opened from the hub). G-WF-2: Minimum notice and Booking window say what they mean.
// G-WF-4: the type forms ask before unsaved edits are lost: choosing another type, a link out
// of the page, and Cancel / Escape in the Add or Edit dialog. Mock mode, synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/calendar/types'));
  const settings = page.getByTestId('type-settings');
  await expect(settings.getByLabel('Booking window')).toBeVisible({ timeout: 60_000 });
  return settings;
}

test('G-WF-2: Minimum notice and Booking window explain themselves', async ({ page }) => {
  const settings = await open(page);
  await expect(settings.getByLabel('Minimum notice')).toHaveAccessibleDescription(
    'How far ahead a client must book. 2 hours: at 10 a.m., noon is the earliest start.',
  );
  await expect(settings.getByLabel('Booking window')).toHaveAccessibleDescription(
    'How far into the future clients can book. 1 day ahead: up to 24 hours away.',
  );
});

test('G-WF-4: choosing another type with unsaved settings asks first', async ({ page }) => {
  const settings = await open(page);
  const heading = settings.getByRole('heading', { level: 2 });
  const first = (await heading.innerText()).replace(/ Settings$/, '');
  const other = page
    .getByTestId('types-list')
    .locator('tbody button[aria-pressed="false"]')
    .first();
  const otherName = await other.innerText();

  // Nothing changed: the other type opens at once.
  await other.click();
  await expect(heading).toHaveText(`${otherName} Settings`);
  await page.getByTestId('types-list').getByRole('button', { name: first, exact: true }).click();
  await expect(heading).toHaveText(`${first} Settings`);

  const description = settings.getByLabel('Description (staff only)');
  await description.fill('Unsaved edit (fake)');
  await page
    .getByTestId('types-list')
    .getByRole('button', { name: otherName, exact: true })
    .click();
  const ask = page.getByRole('dialog', { name: 'Discard your changes?' });
  await expect(ask.getByTestId('type-switch-discard')).toHaveText(
    `Your changes to ${first} settings are not saved. Discard them and open ${otherName}?`,
  );
  await ask.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(ask).toHaveCount(0);
  await expect(heading).toHaveText(`${first} Settings`);
  await expect(description).toHaveValue('Unsaved edit (fake)');

  await page
    .getByTestId('types-list')
    .getByRole('button', { name: otherName, exact: true })
    .click();
  await ask.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(heading).toHaveText(`${otherName} Settings`);
});

test('G-WF-4: leaving with unsaved settings asks; after Save it does not', async ({ page }) => {
  const settings = await open(page);
  const notice = settings.getByLabel('Minimum notice');
  const current = await notice.inputValue();
  await notice.selectOption(current === '24' ? '48' : '24');

  await page.getByRole('link', { name: 'Back to Appointments' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(page).toHaveURL(/\/calendar\/types$/);
  await expect(notice).not.toHaveValue(current);

  await settings.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');
  await page.getByRole('link', { name: 'Back to Appointments' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(leave).toHaveCount(0);
});

test('G-WF-4: the Add Type dialog asks before discarding what was typed', async ({ page }) => {
  await open(page);
  const add = page.getByRole('button', { name: 'Add Type' }).first();

  // Untouched: Cancel just closes.
  await add.click();
  await page
    .getByRole('dialog', { name: 'Add Appointment Type' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await add.click();
  const form = page.getByRole('dialog', { name: 'Add Appointment Type' });
  await form.getByLabel('Name *').fill('Draft type (fake)');
  await form.getByRole('button', { name: 'Cancel' }).click();
  const ask = page.getByRole('dialog', { name: 'Discard your changes?' });
  await expect(ask.getByTestId('type-modal-discard')).toHaveText(
    'This new appointment type is not added yet. Discard it?',
  );
  await ask.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(form.getByLabel('Name *')).toHaveValue('Draft type (fake)');

  // Escape asks too; Discard closes without adding anything.
  await page.keyboard.press('Escape');
  await ask.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('types-list')).not.toContainText('Draft type (fake)');
});
