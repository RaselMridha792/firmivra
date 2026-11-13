import { expect, test } from '@playwright/test';

// Business Advisory review of Oct 25, batch 3 (Octavia): B13, the plan's required fields (§3).
// Next names each blank required field and keeps every entry; optional fields stay optional;
// the strategy needs its summary and an explicit focus, an area or None / Not Applicable, never
// both. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/business-advisory`;
const startupPlan = `${base}/plans/0199c0f1-a400-7000-8000-000000000002/edit`;

test('B13: Next names each blank required field, keeps the entries, and leaves optional ones optional', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/plans/new?advisoryClientId=0199c0f1-a200-7000-8000-000000000002`);
  await expect(page.getByLabel('Business Name')).toHaveValue('SL Beauty Studio', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('required-legend')).toContainText('Fields marked *');
  await page.getByLabel('Notes (optional)').fill('Wants online booking first.');
  await page.getByTestId('wizard-next').click();
  await expect(
    page.getByText(/Fill in the required fields to continue \(\d+ missing/),
  ).toBeVisible();
  // The client record filled the business, its address and contact; the rest is named.
  for (const message of [
    'Enter the plan name.',
    'Choose the plan type.',
    'Choose how they heard about us.',
  ])
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText('Enter the business name.', { exact: true })).toHaveCount(0);
  // Optional fields never say so, and what was typed is kept.
  await expect(page.getByText('Enter the website')).toHaveCount(0);
  await expect(page.getByLabel('Notes (optional)')).toHaveValue('Wants online booking first.');
  await page.screenshot({ path: test.info().outputPath('plan-required.png') });

  await page.getByLabel('Plan Name').fill('Salon Growth Plan');
  await page.getByLabel('Plan Type').selectOption({ index: 1 });
  for (const [label, value] of [
    ['Street Address', '100 Sample Street'],
    ['ZIP Code', '30030'],
    ['Phone Number', '(404) 555-0100'],
    ['Email Address', 'salon@example.test'],
  ] as const) {
    const field = page.getByLabel(label);
    if (!(await field.inputValue())) await field.fill(value);
  }
  await page.getByLabel('How did you hear about us?').selectOption('Existing Client');
  await expect(page.getByText('Enter the plan name.', { exact: true })).toHaveCount(0);
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}\/edit\/assessment$/, { timeout: 60_000 });
});

test('B13: the strategy needs its summary and a focus; an area and None / Not Applicable clear each other', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${startupPlan}/goals`);
  const areas = page.getByTestId('step-areas');
  await expect(areas).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('Write the strategy summary.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('focus-missing')).toBeVisible();

  const none = areas.getByRole('checkbox', { name: 'None / Not Applicable' });
  const marketing = areas.getByRole('checkbox', { name: 'Marketing / Sales' });
  await none.check();
  await marketing.check();
  await expect(none).not.toBeChecked();
  await none.check();
  await expect(marketing).not.toBeChecked();
  await expect(page.getByLabel('Marketing / Sales objective')).toHaveCount(0);
  await page.getByLabel('Strategy summary').fill('Open with a steady weekly booking base.');
  await page.screenshot({ path: test.info().outputPath('strategy-none.png') });
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('step-milestones')).toBeVisible({ timeout: 60_000 });

  // Back on the step (the mock keeps its data in the page), None / Not Applicable is kept.
  await page.getByRole('button', { name: /Back: Goals & Strategy/ }).click();
  await expect(
    page.getByTestId('step-areas').getByRole('checkbox', { name: 'None / Not Applicable' }),
  ).toBeChecked({ timeout: 60_000 });
  await expect(page.getByLabel('Strategy summary')).toHaveValue(
    'Open with a steady weekly booking base.',
  );
});

test('B17: Search Existing Clients adds a firm client to advisory and chooses them, never twice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/plans/new`);
  await page.getByTestId('search-existing-clients').click({ timeout: 60_000 });
  const dialog = page.getByTestId('search-existing-client');
  await dialog.getByLabel('Search clients').fill('Acme');
  const results = dialog.getByRole('list', { name: 'Matching clients' });
  await expect(results).toContainText('Acme Widgets LLC (fake)');
  await results.getByRole('button', { name: 'Add to Advisory', exact: true }).first().click();
  await dialog.getByLabel('Primary service focus').selectOption({ label: 'Business Planning' });
  const add = page.getByRole('dialog').getByRole('button', { name: 'Add to Advisory and Choose' });
  await expect(add).toBeEnabled();
  await page.waitForTimeout(500); // the button's colour transition, for the screenshot
  await page.screenshot({ path: test.info().outputPath('search-existing-client.png') });
  await add.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('client-card')).toContainText('Acme Widgets LLC (fake)', {
    timeout: 60_000,
  });

  // Now in the program: the search chooses them as they are, with nothing added.
  await page.getByTestId('search-existing-clients').click();
  await dialog.getByLabel('Search clients').fill('Acme');
  await expect(results.getByRole('button', { name: 'Choose', exact: true }).first()).toBeVisible();
  await expect(results.getByRole('button', { name: 'Add to Advisory', exact: true })).toHaveCount(
    0,
  );
});
