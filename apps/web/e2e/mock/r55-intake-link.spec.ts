import { expect, type Page, test } from '@playwright/test';

// R55, Intake Forms Review Two (ACCESS-01): a lead opens the form the firm emailed through its
// secure link (/{firm}/form#token=...), signed out. The token leaves the address once read; the
// form opens with the portal's own steps and saves, and takes files in its upload fields (Leads
// item n). A made-up link says to ask for a new one. In mock mode (playwright.mock.config.ts;
// mocks/intake-link.ts). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const TOKEN = 'mock-intake-link-token-'.padEnd(43, '0');

test('opens the emailed link signed out, clears the token from the address and saves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/form#token=${TOKEN}`));
  const screen = page.getByTestId('intake-link');
  await expect(screen).toContainText('Hi Pat');
  await expect(page).toHaveURL(/\/lvp\/form$/);
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(screen.getByTestId('intake-next')).toHaveText(/Continue/);
  // No way back into a portal the lead doesn't have.
  await expect(screen.getByRole('link', { name: 'All intake forms' })).toHaveCount(0);
  await screen.getByRole('button', { name: 'Save and Continue Later' }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'Your answers are saved' }),
  ).toContainText('Open the link in your email again');
});

test('a made-up or incomplete link asks for a new one', async ({ page }) => {
  await page.goto(portal(`/lvp/form#token=${'x'.repeat(43)}`));
  await expect(page.getByTestId('intake-link-problem')).toContainText(
    'Ask your firm to send a new one',
  );
  // A new load: going to the same page with only another #fragment would not reload it.
  await page.goto('about:blank');
  await page.goto(portal('/lvp/form#token=short'));
  await expect(page.getByTestId('intake-link-problem')).toContainText('This link is not complete');
});

/** A valid sample for an input (as r22-intake-forms.spec). */
function sampleFor(type: string, field: string, inputType: string): string {
  if (inputType === 'email' || type === 'email') return 'owner@example.test';
  if (inputType === 'tel' || type === 'phone') return '4045550123';
  if (inputType === 'date') return '2024-01-15';
  if (inputType === 'month') return '2024-01';
  if (inputType === 'url' || type === 'url') return 'example.test';
  if (inputType === 'password') return '123456789';
  if (type === 'zip' || /zip/i.test(field)) return '30303';
  if (type === 'year') return '2024';
  if (type === 'number') return '3';
  if (type === 'currency') return '1250.50';
  return 'Synthetic answer';
}

/** Answers every empty, shown input of the step (as r22's fillStep). */
async function fillStep(page: Page) {
  const root = page.getByTestId('intake-link');
  for (let round = 0; round < 3; round += 1) {
    for (const input of await root.locator('input:visible').all()) {
      const inputType = (await input.getAttribute('type')) ?? 'text';
      if (['radio', 'checkbox', 'file'].includes(inputType) || (await input.inputValue())) {
        continue;
      }
      const type = (await input.getAttribute('data-type')) ?? '';
      const field = (await input.getAttribute('data-field')) ?? '';
      const decimal = (await input.getAttribute('inputmode')) === 'decimal';
      await input.fill(decimal && !type ? '100' : sampleFor(type, field, inputType));
    }
    for (const area of await root.locator('textarea:visible').all()) {
      if (!(await area.inputValue())) await area.fill('Synthetic details.');
    }
    for (const select of await root.locator('select:visible').all()) {
      if (!(await select.inputValue())) await select.selectOption({ index: 1 });
    }
    for (const set of await root.locator('fieldset:visible').all()) {
      const choices = set.locator('input[type=radio], input[type=checkbox]');
      if ((await choices.count()) === 0 || (await set.locator('input:checked').count()) > 0) {
        continue;
      }
      await choices.first().check();
    }
  }
}

test('takes a file in an upload field through the link, and removes it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/form#token=${TOKEN}`));
  const screen = page.getByTestId('intake-link');
  await expect(screen).toContainText('Hi Pat');
  await fillStep(page);
  await screen.getByTestId('intake-next').click();
  const slot = screen.locator('[data-slot]').first();
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.locator('input[type=file]').setInputFiles({
    name: 'synthetic-income.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  const item = slot.getByRole('listitem').filter({ hasText: 'synthetic-income.pdf' });
  await expect(item).toBeVisible();
  await expect(slot.getByText('Uploading…')).toHaveCount(0);
  await item.getByRole('button', { name: /Remove/ }).click();
  await expect(item).toHaveCount(0);
});
