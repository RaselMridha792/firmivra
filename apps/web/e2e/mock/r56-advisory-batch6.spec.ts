import { expect, test } from '@playwright/test';

// Business Advisory review of Oct 25, batch 6 (Octavia's §4, §6, §7): B14, persistent helper text
// below each approved field's label and above its input, read as the field's description;
// Current Customers; How the Business Operates first in Operations; Opportunities and Threats.
// The recommendation helpers are her PROPOSED copy. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/business-advisory`;
const startupPlan = `${base}/plans/0199c0f1-a400-7000-8000-000000000002/edit`;

test('B14: the assessment shows the approved helper text and keeps the new SWOT fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  // The mock dev server can answer 404 for a plan's edit pages when they are its first page
  // (curl and next build serve them); opening the plan list first avoids that.
  await page.goto(`${base}/plans`);
  await expect(page.getByTestId('ba-plans')).toBeVisible({ timeout: 60_000 });
  await page.goto(`${startupPlan}/assessment`);
  const sales = page.getByTestId('step-sales');
  await expect(sales).toBeVisible({ timeout: 60_000 });
  for (const [label, hint] of [
    ['Current Customers', 'Describe who currently buys your products or services.'],
    [
      'Sales Trend',
      'Describe whether sales are increasing, decreasing, or steady, and over what period.',
    ],
    [
      'What Sets Your Business Apart',
      'Explain why customers choose your business over alternatives.',
    ],
  ] as const)
    await expect(sales.getByLabel(label)).toHaveAccessibleDescription(hint);
  await expect(
    page.getByTestId('step-funding').getByLabel('Amount Needed ($)'),
  ).toHaveAccessibleDescription('Total funding requested.');

  // How the Business Operates is first in Operations, optional.
  const operations = page.getByTestId('step-operations');
  const how = operations.getByRole('textbox').first();
  await expect(how).toHaveAccessibleName('How the Business Operates (optional)');
  await how.fill('Fake: two stylists, booked a week out, one supplier.');

  // Strengths and Challenges stay; Opportunities and Threats are added, each with its helper.
  const swot = page.getByTestId('step-swot');
  await expect(
    swot.getByRole('textbox', { name: 'Add to challenges' }),
  ).toHaveAccessibleDescription('What internal limitations or gaps need improvement?');
  for (const [list, line] of [
    ['opportunities', 'Fake: a new office park nearby'],
    ['threats', 'Fake: rising product costs'],
  ] as const) {
    const box = swot.getByRole('textbox', { name: `Add to ${list}` });
    await box.fill(line);
    await box.press('Enter');
    await expect(swot.getByText(line, { exact: true })).toBeVisible();
  }
  await page.evaluate(() =>
    document.querySelector('[data-testid="step-sales"]')?.scrollIntoView({ block: 'start' }),
  );
  await page.screenshot({ path: test.info().outputPath('assessment-helper-text.png') });

  // Next saves them; coming back shows them as saved.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/goals$/, { timeout: 60_000 });
  await page.goBack();
  await expect(page.getByTestId('step-operations').getByRole('textbox').first()).toHaveValue(
    'Fake: two stylists, booked a week out, one supplier.',
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('step-swot')).toContainText('Fake: a new office park nearby');
  await expect(page.getByTestId('step-swot')).toContainText('Fake: rising product costs');
});

test('B14: the goal Description and the recommendation fields explain themselves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/goals`);
  await expect(page.getByTestId('ba-goals').getByTestId('goal-link').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Add Business Goal' }).click();
  await expect(page.getByTestId('add-goal').getByLabel('Description')).toHaveAccessibleDescription(
    'Explain what this goal will achieve and how success will be measured.',
  );
  await page.screenshot({ path: test.info().outputPath('goal-description-helper.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`${base}/action-plans`);
  const recs = page.getByTestId('ba-recommendations');
  await recs.getByRole('button', { name: 'Add Recommendation' }).click({ timeout: 60_000 });
  const dialog = page.getByTestId('add-recommendation');
  await expect(dialog.getByLabel('Estimated Financial Impact ($)')).toHaveAccessibleDescription(
    /^Enter the estimated financial benefit, if known\./,
  );
  await expect(dialog.getByLabel('Rationale')).toHaveAccessibleDescription(
    'Explain why this recommendation is appropriate, including the problem or opportunity it addresses.',
  );
  await expect(
    dialog.getByRole('checkbox', { name: 'Show on Client Portal' }),
  ).toHaveAccessibleDescription(/^Make this recommendation available in the client portal/);
  // Category offers the nine focus areas and still takes a typed category.
  const category = dialog.getByLabel('Category');
  const listId = await category.getAttribute('list');
  await expect(page.locator(`datalist[id="${listId}"] option`)).toHaveCount(9);
  await category.fill('Fake: pricing');
  await expect(category).toHaveValue('Fake: pricing');
  await page.screenshot({ path: test.info().outputPath('recommendation-helper.png') });
});
