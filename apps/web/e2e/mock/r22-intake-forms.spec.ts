import { expect, test, type Locator, type Page } from '@playwright/test';

// The Begin Online service forms on the intake engine (begin/_blocks), in mock mode: start, every
// step with its required-field errors, Previous and Continue, the review with Edit, the agreement,
// the submit and the success page; and no sideways scroll at 375 px. Synthetic data only.
test.describe.configure({ timeout: 240_000 });

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://portal.localhost:${port}`;

const FORMS = [
  // The first return type (Personal) hides step 2, Business Income & Expenses.
  { path: 'annual-tax', title: 'Annual Tax Intake Form', steps: 3 },
  { path: 'quarterly-tax', title: 'Quarterly Tax Intake Form', steps: 4 },
  { path: 'bookkeeping', title: 'Business Bookkeeping Intake Form', steps: 4 },
  { path: 'payroll', title: 'Payroll Services Intake Form', steps: 3 },
  { path: 'tax-planning', title: 'Tax Planning Intake Form', steps: 4 },
  { path: 'business-development', title: 'Business Development Intake Form', steps: 4 },
] as const;

const PDF = {
  name: 'synthetic.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 synthetic'),
};

const form = (page: Page) => page.getByTestId('intake-page');
const current = (page: Page) => page.locator('[aria-current="step"]');

async function start(page: Page, path: string) {
  await page.goto(`${origin}/lvp/begin/${path}`);
  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Example');
  await page.getByLabel('Email Address *').fill('avery@example.test');
  await page.getByRole('button', { name: 'Start My Form' }).click();
  await expect(current(page)).toContainText(/./);
}

function sampleFor(type: string, field: string, inputType: string): string {
  if (inputType === 'email' || type === 'email') return 'owner@example.test';
  if (inputType === 'tel' || type === 'phone') return '4045550123';
  if (inputType === 'date') return '2024-01-15';
  if (inputType === 'month') return '2024-01';
  if (inputType === 'url' || type === 'url') return 'example.test';
  if (inputType === 'password') return '123456789';
  if (type === 'zip') return '30303';
  if (type === 'year') return '2024';
  if (type === 'number') return '3';
  if (type === 'currency') return '1250.50';
  if (/zip/i.test(field)) return '30303';
  return 'Synthetic answer';
}

/** Answers every empty input of the step (the shown ones), until no new field appears. */
async function fillStep(page: Page) {
  const root = form(page).locator('form');
  for (let round = 0; round < 4; round += 1) {
    for (const input of await root.locator('input:visible').all()) {
      const inputType = (await input.getAttribute('type')) ?? 'text';
      if (['radio', 'checkbox', 'file'].includes(inputType)) continue;
      if (await input.inputValue()) continue;
      const type = (await input.getAttribute('data-type')) ?? '';
      const field = (await input.getAttribute('data-field')) ?? '';
      const decimal = (await input.getAttribute('inputmode')) === 'decimal';
      await input.fill(decimal && !type ? '100' : sampleFor(type, field, inputType));
    }
    for (const area of await root.locator('textarea:visible').all()) {
      if (!(await area.inputValue())) await area.fill('Synthetic details for testing.');
    }
    for (const select of await root.locator('select:visible').all()) {
      if (!(await select.inputValue())) await select.selectOption({ index: 1 });
    }
    for (const set of await root.locator('fieldset:visible').all()) {
      const choices = set.locator('input[type=radio], input[type=checkbox]');
      if ((await choices.count()) === 0) continue;
      if ((await set.locator('input:checked').count()) > 0) continue;
      await choices.first().check();
    }
    const emptyGroups = root.locator('[data-group][data-rows="0"]');
    while ((await emptyGroups.count()) > 0) {
      await emptyGroups.first().getByRole('button').last().click();
    }
    for (const slot of await root.locator('[data-slot]').all()) {
      if ((await slot.getByRole('listitem').count()) > 0) continue;
      await slot.locator('input[type=file]').setInputFiles(PDF);
      await expect(slot.getByRole('listitem').first()).toBeVisible();
    }
    // Single required tick boxes (certifications), not "I don't have this document".
    for (const box of await root.getByRole('checkbox', { name: /\*$/ }).all()) {
      if (await box.isVisible()) await box.check();
    }
  }
}

async function continueTo(page: Page, step: number) {
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(current(page).getByRole('button')).toHaveText(String(step), { timeout: 20_000 });
}

for (const f of FORMS) {
  test(`${f.path}: required errors, every step, review, sign and submit`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await start(page, f.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(f.title);

    // Required fields stop Continue on the first step, with errors by the fields.
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('alert').first()).toContainText('Please complete the highlighted');
    await expect(form(page).locator('[aria-invalid="true"]').first()).toBeVisible();

    for (let step = 1; step < f.steps; step += 1) {
      await fillStep(page);
      await continueTo(page, step + 1);
      if (step === 1) {
        // Previous goes back with the answers kept.
        await page.getByRole('button', { name: 'Previous' }).click();
        await expect(current(page).getByRole('button')).toHaveText('1');
        await continueTo(page, 2);
      }
    }

    // The review: a card per step with Edit, then the review step's own fields and the agreement.
    const review = page.getByTestId('intake-review');
    await expect(review).toBeVisible();
    await expect(review.getByRole('button', { name: /^Edit / })).toHaveCount(f.steps - 1);
    await expect(review).not.toContainText('123456789');
    await page.screenshot({ path: test.info().outputPath(`${f.path}-review.png`), fullPage: true });

    await page.getByRole('button', { name: 'Submit Intake Form' }).click();
    await expect(page.getByRole('alert').last()).toBeVisible();
    await fillStep(page);
    // R14's agreement block: its required boxes (ticked by fillStep), then the typed signature.
    await expect(page.getByRole('region', { name: /agreement/i }).first()).toBeVisible();
    await page.getByLabel('Full Name *', { exact: true }).fill('Avery Example');
    await page.getByLabel('Signature (type your full name) *').fill('Avery Exampel');
    await page.getByRole('button', { name: 'Submit Intake Form' }).click();
    await expect(page.getByText('Type your name exactly as printed.')).toBeVisible();
    await page.getByLabel('Signature (type your full name) *').fill('Avery Example');
    await page.getByRole('button', { name: 'Submit Intake Form' }).click();
    await expect(page).toHaveURL(`${origin}/lvp/begin/done?form=${f.path}`, { timeout: 20_000 });
  });
}

test('a phone-width form has no sideways scroll and works by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await start(page, 'bookkeeping');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath('bookkeeping-375.png'), fullPage: true });
  // Keyboard: Tab reaches the first input of the form.
  const first: Locator = form(page).locator('form input:visible').first();
  await first.focus();
  await page.keyboard.type('Synthetic Books LLC');
  await expect(first).toHaveValue(/Synthetic Books LLC/);
});

test('Save and Continue Later saves the step and confirms the email', async ({ page }) => {
  await start(page, 'tax-planning');
  await page.getByRole('button', { name: 'Save and Continue Later' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'continue later' })).toContainText(
    'avery@example.test',
  );
});

test('the success pages: tax preparation and every other service', async ({ page }) => {
  await page.goto(`${origin}/lvp/begin/done?form=annual-tax`);
  await expect(page.getByRole('heading', { name: 'Success!' })).toBeVisible();
  await expect(page.getByText('A free initial tax consultation')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Schedule an Appointment' })).toHaveAttribute(
    'href',
    '/lvp/appointments',
  );
  await page.goto(`${origin}/lvp/begin/done?form=payroll`);
  await expect(page.getByText('Your Assigned Specialist Will Reach Out')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('a resume link opens the saved form; an expired one asks for a new link', async ({ page }) => {
  await page.goto(`${origin}/lvp/begin/resume#token=mockSavedAnnualTaxDraft00000000000000000001`);
  await expect(page).toHaveURL(`${origin}/lvp/begin/annual-tax`, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Annual Tax Intake Form');

  await page.goto(`${origin}/lvp/begin/resume#token=mockExpiredBookkeepingDraft0000000000000002`);
  await expect(page.getByTestId('begin-resume').getByRole('alert')).toContainText(
    'no longer valid',
  );
  expect(page.url()).toBe(`${origin}/lvp/begin/resume`);
  await page.getByLabel('Email Address *').fill('avery@example.test');
  await page.getByRole('button', { name: 'Email Me My Link' }).click();
  await expect(page.getByTestId('begin-resume').getByRole('status')).toContainText(
    'avery@example.test',
  );
});

test('a field the answers hide never blocks the save (a leftover spouse SSN)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page, 'annual-tax');
  await page.getByRole('radio', { name: 'Married Filing Jointly' }).check();
  await page.getByLabel('Spouse SSN *').fill('123');
  await page.getByLabel('Spouse Email Address').fill('jane@');
  await page.getByRole('radio', { name: 'Single', exact: true }).check();
  await expect(page.getByLabel('Spouse SSN *')).toHaveCount(0);
  await fillStep(page);
  await continueTo(page, 2);
});

test('leaving and reopening a form loads the saved answers, not the first ones', async ({
  page,
}) => {
  // Open the form from the Begin Online page, so Back is a client navigation.
  await page.goto(`${origin}/lvp/begin`);
  await page.getByRole('link', { name: /Tax Planning Intake Form/ }).click();
  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Example');
  await page.getByLabel('Email Address *').fill('avery@example.test');
  await page.getByRole('button', { name: 'Start My Form' }).click();
  const first = form(page).locator('form input[data-type="text"]:visible').first();
  await fillStep(page);
  await first.fill('Saved Name');
  await continueTo(page, 2);
  // Client navigation away and back (the cached draft would bring back the empty first answers).
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/lvp/begin`);
  await page.getByRole('link', { name: /Tax Planning Intake Form/ }).click();
  await expect(current(page).getByRole('button')).toHaveText('2', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(form(page).locator('form input[data-type="text"]:visible').first()).toHaveValue(
    'Saved Name',
  );
});

test('after a submit, opening the service again starts a new form with a notice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page, 'payroll');
  for (let step = 1; step < 3; step += 1) {
    await fillStep(page);
    await continueTo(page, step + 1);
  }
  await fillStep(page);
  await page.getByLabel('Full Name *', { exact: true }).fill('Avery Example');
  await page.getByLabel('Signature (type your full name) *').fill('Avery Example');
  await page.getByRole('button', { name: 'Submit Intake Form' }).click();
  await expect(page).toHaveURL(`${origin}/lvp/begin/done?form=payroll`, { timeout: 20_000 });
  await page.getByRole('link', { name: 'Back to Begin Online' }).click();
  await page.getByRole('link', { name: /Payroll Intake Form/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'was sent' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Start My Form' })).toBeVisible();
});
