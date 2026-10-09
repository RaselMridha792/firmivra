import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://portal.localhost:${port}/lvp/begin/annual-tax`;
async function personal(page: Page, business = false) {
  await page.getByLabel('First name', { exact: true }).fill('Synthetic');
  await page.getByLabel('Last name', { exact: true }).fill('Client');
  await page
    .getByRole('region', { name: 'Personal & Filing Information', exact: true })
    .getByLabel('Date of Birth *', { exact: true })
    .fill('1990-02-03');
  await page.getByLabel('Phone Number *', { exact: true }).fill('4705550123');
  await page.getByLabel('Email Address *', { exact: true }).fill('intake@example.test');
  await page.getByLabel('Social Security Number (SSN) *', { exact: true }).fill('111223333');
  await page.getByLabel('Physical Address * street').fill('100 Example Street');
  await page.getByLabel('Physical Address * city').fill('Atlanta');
  await page.getByLabel('Physical Address * state').selectOption('GA');
  await page.getByLabel('Physical Address * ZIP code').fill('30303');
  await page.getByRole('radio', { name: 'Single', exact: true }).check();
  await page
    .getByRole('radio', {
      name: business ? 'Business (1120, 1120-S, 1065, etc.)' : 'Personal (1040)',
      exact: true,
    })
    .check();
  await page.getByRole('radio', { name: 'U.S. Citizen', exact: true }).check();
  for (const radio of await page.getByRole('radio', { name: 'No', exact: true }).all())
    await radio.check();
}
async function fillBusiness(page: Page) {
  const card = page.getByTestId('business-1');
  await card.getByRole('radio', { name: 'LLC', exact: true }).check();
  await card.getByLabel('Business Legal Name *').fill('Synthetic Business LLC');
  await card.getByLabel('Business EIN *').fill('123456789');
  await card.getByLabel('Business Address * street').fill('200 Example Avenue');
  await card.getByLabel('Business Address * city').fill('Atlanta');
  await card.getByLabel('Business Address * state').selectOption('GA');
  await card.getByLabel('Business Address * ZIP code').fill('30303');
  await card.getByRole('radio', { name: 'Services', exact: true }).check();
  await card
    .getByLabel('What kind of products or services do you sell? *')
    .fill('Synthetic consulting services');
}
async function explain(page: Page, label: string) {
  const tile = page.getByTestId(`upload-${label}`);
  await tile.getByRole('checkbox', { name: "I don't have this document" }).check();
  await tile
    .getByLabel(`Reason for unavailable ${label}`)
    .fill('Will provide this synthetic document later.');
}
async function documents(page: Page, business = false) {
  await explain(page, 'Your Government ID');
  await page.getByLabel('Your Social Security Card files', { exact: true }).setInputFiles({
    name: 'synthetic-ss-card.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic test document'),
  });
  if (business) {
    await explain(page, 'Business Income & Expenses Documentation');
    await explain(page, 'Business EIN & Formation Documents');
  }
  await page.getByRole('checkbox', { name: /^Yes, I certify/ }).check();
}

test('validation, conditional skipping, files, masked review, editing and unavailable submission', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('annual-tax-form').getByRole('alert')).toContainText(
    'highlighted fields',
  );
  await expect(page.getByText('First name is required.', { exact: true })).toBeVisible();
  await personal(page);
  await expect(page.getByTestId('annual-tax-form').getByRole('alert')).toHaveCount(0);
  const ssn = page.getByLabel('Social Security Number (SSN) *', { exact: true });
  await expect(ssn).toHaveAttribute('type', 'password');
  const progress = page.getByRole('list', { name: 'Intake progress' });
  await expect(progress.getByRole('listitem')).toHaveCount(3);
  await expect(progress.getByRole('button')).toHaveText(['1', '2', '3']);
  await expect(page.getByLabel('Comments / Additional Information', { exact: true })).toBeVisible();
  await expect(page.getByText('Comments (optional)', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Show Social Security Number (SSN)', exact: true })
    .click();
  await expect(ssn).toHaveValue('111-22-3333');
  await page
    .getByRole('button', { name: 'Hide Social Security Number (SSN)', exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath('annual-step-1.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Required Document Uploads', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Business Income', exact: true })).toHaveCount(0);
  await expect(progress.locator('[aria-current="step"] button')).toHaveText('2');
  await page.getByRole('button', { name: 'Continue to Next Step' }).click();
  await expect(page.getByTestId('annual-tax-form').getByRole('alert')).toBeVisible();
  await page.getByLabel('Your Government ID files', { exact: true }).setInputFiles({
    name: 'not-an-id.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic'),
  });
  await expect(
    page.getByText('Use non-empty PDF, JPG or PNG files, up to 10 MB each.'),
  ).toBeVisible();
  await page.getByLabel('Your Government ID files', { exact: true }).setInputFiles({
    name: 'too-large.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText('Use non-empty PDF, JPG or PNG files, up to 10 MB each.'),
  ).toBeVisible();
  await documents(page);
  await page.screenshot({ path: testInfo.outputPath('annual-step-3.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue to Next Step' }).click();
  await expect(page.getByTestId('review-ssn')).toHaveText('•••-••-3333');
  await expect(progress.locator('[aria-current="step"] button')).toHaveText('3');
  await expect(page.getByTestId('annual-review')).not.toContainText('111223333');
  await expect(
    page.getByRole('radio', { name: 'I want to pay from my refund', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Edit Personal Information', exact: true }).click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Synthetic');
  await page.getByLabel('First name', { exact: true }).fill('Updated');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('synthetic-ss-card.pdf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Next Step' }).click();
  await expect(page.getByText('Updated Client', { exact: true })).toBeVisible();
  await page
    .getByRole('radio', { name: 'I want to pay now with a 10% discount', exact: true })
    .check();
  await page.getByRole('region', { name: 'Service agreement excerpt' }).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page
    .getByRole('checkbox', { name: /^I have read and understand the Service Agreement excerpt/ })
    .check();
  await page.getByLabel('Signature (typed full name) *').fill('Updated Client');
  await page.getByLabel('Date *', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.screenshot({ path: testInfo.outputPath('annual-step-4.png'), fullPage: true });
  await page.getByRole('button', { name: 'Submit Intake Form' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Online submission is not available yet.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Social Security Number (SSN) *', { exact: true })).toHaveValue('');
});

test('business and dependent repeaters, decimal totals and step-two edit retain answers', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(url);
  await personal(page, true);
  const returnTypeGroup = page.getByRole('group', {
    name: 'Type of Tax Return(s) You Need (Select one) *',
  });
  await returnTypeGroup.getByRole('radio', { name: 'Personal (1040)', exact: true }).check();
  await expect(returnTypeGroup.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Intake progress' }).getByRole('button')).toHaveText([
    '1',
    '2',
    '3',
  ]);
  await returnTypeGroup
    .getByRole('radio', { name: 'Both Personal & Business', exact: true })
    .check();
  await expect(returnTypeGroup.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Intake progress' }).getByRole('button')).toHaveText([
    '1',
    '2',
    '3',
    '4',
  ]);
  await returnTypeGroup
    .getByRole('radio', { name: 'Business (1120, 1120-S, 1065, etc.)', exact: true })
    .check();
  const spouse = page.getByRole('group', { name: 'Spouse information', exact: true });
  await expect(spouse.getByLabel('Spouse SSN', { exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Married Filing Jointly', exact: true }).check();
  await expect(spouse.getByLabel('Spouse SSN', { exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Married Filing Separately', exact: true }).check();
  await expect(spouse.getByLabel('Spouse SSN', { exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Single', exact: true }).check();
  await expect(spouse.getByLabel('Spouse SSN', { exact: true })).toBeDisabled();
  await fillBusiness(page);
  await page.getByRole('button', { name: 'Add Another Business', exact: true }).click();
  await expect(page.getByTestId('business-2')).toBeVisible();
  await page.getByRole('button', { name: 'Remove business 2', exact: true }).click();
  await page
    .getByRole('group', { name: 'Do you have any dependents? *' })
    .getByRole('radio', { name: 'Yes', exact: true })
    .check();
  await page.getByRole('button', { name: 'Add Another Dependent', exact: true }).click();
  const dependent = page.getByTestId('dependent-2');
  await dependent.getByLabel('Full Name * First name', { exact: true }).fill('Synthetic');
  await dependent.getByLabel('Full Name * Last name', { exact: true }).fill('Dependent');
  await dependent.getByLabel('Date of Birth *').fill('2015-03-12');
  await dependent.getByLabel('Relationship to you *').selectOption('Daughter');
  await page.getByRole('button', { name: 'Remove dependent 1', exact: true }).click();
  await expect(page.getByTestId('dependent-1').getByLabel('Full Name * Last name')).toHaveValue(
    'Dependent',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Business Income', exact: true })).toBeVisible();
  await page.getByLabel('Sales of Products Q1', { exact: true }).fill('0.10');
  await page.getByLabel('Sales of Products Q2', { exact: true }).fill('0.20');
  await expect(page.locator('output[aria-label="Sales of Products annual total"]')).toHaveText(
    '$0.30',
  );
  await page.getByLabel('Sales of Products Q3', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Enter a non-negative amount with up to 2 decimal places.'),
  ).toBeVisible();
  await page.getByLabel('Sales of Products Q3', { exact: true }).fill('100.25');
  await page.getByLabel('Advertising & Marketing annual amount').fill('10');
  await page.getByLabel('Telephone & Internet annual amount').fill('20');
  await expect(
    page.locator('output[aria-label="Business Expenses Total Annual total"]'),
  ).toHaveText('$30.00');
  await page.screenshot({ path: testInfo.outputPath('annual-step-2.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath('annual-mobile-step-2.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await documents(page, true);
  await explain(page, 'Dependent(s) Qualifying Documents');
  const identity = page.getByRole('region', {
    name: 'Identity Verification Documents',
    exact: true,
  });
  for (const selector of ['button[aria-label^="Select "]', 'input[type="checkbox"]', 'textarea']) {
    const tops = await identity
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(tops).toHaveLength(5);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  }
  const income = page.getByRole('region', { name: 'Income Documents', exact: true });
  const layout = await income.evaluate((element) => {
    const header = element.querySelector('header')!.getBoundingClientRect();
    const icon = element.querySelector('header > span')!.getBoundingClientRect();
    const heading = element.querySelector('h2')!.getBoundingClientRect();
    const examples = element.querySelector('aside')!.getBoundingClientRect();
    return {
      headerY: header.top,
      examplesY: examples.top,
      iconX: icon.left,
      headingX: heading.left,
    };
  });
  expect(layout.iconX).toBeLessThan(layout.headingX);
  expect(Math.abs(layout.examplesY - layout.headerY)).toBeLessThanOrEqual(1);
  const formation = page.getByRole('region', {
    name: 'Business EIN & Formation Documents',
    exact: true,
  });
  const points = await formation.locator('aside li').evaluateAll((elements) =>
    elements.map((element) => ({
      x: element.getBoundingClientRect().left,
      y: element.getBoundingClientRect().top,
    })),
  );
  expect(points.length).toBeGreaterThan(1);
  expect(new Set(points.map((point) => point.x)).size).toBe(1);
  expect(points.every((point, index) => !index || point.y > points[index - 1]!.y)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('annual-business-step-3.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Continue to Next Step' }).click();
  await expect(page.getByText('Synthetic Dependent', { exact: true })).toBeVisible();
  await expect(page.getByTestId('annual-review')).not.toContainText('123456789');
  await page.getByText('Business Income & Expenses', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit Business Income & Expenses', exact: true }).click();
  await expect(page.getByLabel('Sales of Products Q3', { exact: true })).toHaveValue('100.25');
});

test('375px personal flow stays within the viewport through review', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await personal(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await documents(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Continue to Next Step' }).click();
  await expect(page.getByTestId('review-ssn')).toHaveText('•••-••-3333');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath('annual-mobile-review.png'), fullPage: true });
});
