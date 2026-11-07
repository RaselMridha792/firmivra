import { expect, test } from '@playwright/test';

// R56: the firm Reports module in mock mode (every module on mock data, as an Owner): nine report
// categories, eleven quick reports, four recent and four scheduled reports.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/reports`;

test('Dashboard: range, four KPIs, category cards, quick reports and the three lists', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByTestId('reports-kpis').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByTestId('category-cards').locator(':scope > li')).toHaveCount(9);
  await expect(page.getByTestId('quick-reports').getByRole('link')).toHaveCount(11);
  await expect(page.getByTestId('recent')).toContainText('Revenue Summary');
  await expect(page.getByTestId('scheduled')).toContainText('Weekly Revenue Report');
  await expect(page.getByTestId('insights')).toContainText('Insights');
  await page.getByLabel('Date range', { exact: true }).selectOption('last_month');
  await expect(page.getByTestId('range')).toBeVisible();
});

test('Dashboard: a scheduled report is paused and resumed', async ({ page }) => {
  await page.goto(base);
  const sw = page.getByTestId('scheduled').getByRole('switch', { name: /Weekly Revenue Report/ });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(
    page.getByTestId('scheduled').getByRole('switch', { name: /Weekly Revenue Report/ }),
  ).not.toBeChecked();
});

test('Detail: cards, chart, table, quick range and settings', async ({ page }) => {
  await page.goto(`${base}/revenue-summary`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Revenue Summary');
  await expect(page.getByTestId('report-filters')).toBeVisible();
  // IP-F22: Revenue Summary is the payments received (Stripe's and recorded), as the API's.
  await expect(page.getByTestId('report-kpis').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('report-kpis')).toContainText('Total Payments');
  await expect(page.getByTestId('report-chart')).toBeVisible();
  await expect(page.getByTestId('report-table')).toContainText('Anderson LLC');
  // Octavia's D2: Group By (Payment Method by default) changes the breakdown.
  const groupBy = page.getByTestId('report-breakdown').getByLabel('Group by');
  await expect(groupBy).toHaveValue('method');
  await expect(page.getByTestId('report-breakdown')).toContainText('Cash');
  await groupBy.selectOption({ label: 'Service' });
  await expect(page.getByTestId('report-breakdown')).toContainText('Tax Preparation');
  await expect(groupBy.locator('option')).toHaveText(['Client', 'Service', 'Payment Method']);
  await expect(page.getByTestId('totals')).toContainText('Total');
  await page.getByTestId('quick-range').getByRole('button', { name: 'Last 30 Days' }).click();
  await expect(
    page.getByTestId('quick-range').getByRole('button', { name: 'Last 30 Days' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('switch', { name: 'Show data labels' }).click();
  await page.getByLabel('Search results').fill('anderson');
  await expect(page.getByTestId('report-table')).toContainText('Anderson LLC');
});

test('Detail: More Filters, export, save and schedule', async ({ page }) => {
  await page.goto(`${base}/revenue-summary`);
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByRole('button', { name: 'Add Filter', exact: true }).click();
  await page.getByTestId('more-filters').getByLabel('Field').selectOption({ label: 'Status' });
  await page.getByTestId('more-filters').getByLabel('Value').selectOption('SUCCEEDED');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /More Filters \(1\)/ })).toBeVisible();
  await page
    .getByTestId('report-actions')
    .getByRole('button', { name: 'Export', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'PDF' }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible();
  await page.getByRole('button', { name: 'Schedule Report' }).click();
  await page
    .getByTestId('schedule-dialog')
    .getByLabel('Other email addresses (separated by commas)')
    .fill('cfo@example.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule Report' }).click();
  await expect(page.getByText('Report scheduled.')).toBeVisible();
  await page.getByRole('button', { name: 'Save Report' }).click();
  await page.getByTestId('save-dialog').getByLabel('Report name').fill('My Revenue View');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Report' }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My Revenue View');
  // IP-F24: a saved report is one step from Saved Reports, which lists it and opens it again.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Saved Reports' })
    .click();
  await expect(page).toHaveURL(/\/reports\/library\?tab=saved$/);
  await page.getByRole('link', { name: 'My Revenue View' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My Revenue View');
});

test('Dashboard: Saved Reports is one click away (IP-F24)', async ({ page }) => {
  await page.goto(base);
  await page.getByTestId('saved-reports-link').click();
  await expect(page).toHaveURL(/\/reports\/library\?tab=saved$/);
  await expect(page.getByRole('tab', { name: 'Saved Reports' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Builder: choose a source and columns, preview it, save it', async ({ page }) => {
  await page.goto(`${base}/builder`);
  await expect(page.getByTestId('step-1')).toBeVisible();
  await expect(page.getByTestId('selected-columns').getByRole('listitem').first()).toBeVisible();
  await expect(page.getByTestId('preview')).toContainText('Report Preview');
  await page.getByTestId('step-4').getByLabel('Group By').selectOption({ index: 1 });
  await page.getByRole('switch', { name: 'Show totals' }).click();
  await expect(page.getByTestId('preview')).toContainText('Report Data (Preview)');
  await page.getByRole('button', { name: 'Save Report' }).click();
  await page.getByTestId('save-dialog').getByLabel('Report name').fill('Builder Report');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Report' }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
});

test('Library: recent, saved and scheduled reports', async ({ page }) => {
  await page.goto(`${base}/library`);
  await expect(page.getByTestId('lib-link').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Scheduled Reports' }).click();
  await expect(page.getByRole('table', { name: 'Scheduled reports' })).toContainText(
    'Weekly Revenue Report',
  );
  await page.getByRole('tab', { name: 'Saved Reports' }).click();
  await expect(page.getByRole('heading', { name: /No saved reports yet/ })).toBeVisible();
});

test('Filters fit their field: money in dollars, a bad value named before Apply (RP-F02, F10)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/revenue-summary`);
  await page.getByRole('button', { name: /More Filters/ }).click();
  const dialog = page.getByTestId('more-filters');
  await page.getByRole('button', { name: 'Add Filter', exact: true }).click();
  await dialog.getByLabel('Field').selectOption({ label: 'Amount Collected' });
  await dialog.getByLabel('Condition').selectOption({ label: 'Greater Than' });
  await dialog.getByLabel('Value ($)').fill('abc');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByText('Enter an amount in dollars, like 500 or 500.50.')).toBeVisible();
  await expect(dialog.getByLabel('Value ($)')).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: test.info().outputPath('more-filters.png') });
  await dialog.getByLabel('Value ($)').fill('500');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
    'Amount Collected greater than $500.00',
  );
  await expect(page.getByTestId('run-error')).toHaveCount(0);

  // The builder: the same rows; a filter that does not fit stays out of the preview, said in place.
  await page.goto(`${base}/builder`);
  const step = page.getByTestId('step-3');
  await step.getByRole('button', { name: 'Add Filter', exact: true }).click();
  await step.getByLabel('Field').selectOption({ label: 'Amount Collected' });
  await step.getByLabel('Condition').selectOption({ label: 'Greater Than' });
  await step.getByLabel('Value ($)').fill('abc');
  await expect(step.getByText('Enter an amount in dollars, like 500 or 500.50.')).toBeVisible();
  await expect(step.getByText('One filter is not in the preview until fixed.')).toBeVisible();
  await expect(page.getByText(/The preview could not run/)).toHaveCount(0);
  await step.getByLabel('Value ($)').fill('500');
  await expect(step.getByText('One filter is not in the preview until fixed.')).toHaveCount(0);
  await expect(page.getByTestId('preview')).not.toContainText('Loading…');
  await page.screenshot({ path: test.info().outputPath('builder-filters.png'), fullPage: true });
});

test('A saved report reopens as saved; Save Changes keeps it; Back returns to the library (RP-F03, F06, F12, F13)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/revenue-summary`);
  const settings = page.getByTestId('report-settings');
  await settings.getByLabel('Chart Type').selectOption({ label: 'Line Chart' });
  await page.getByRole('switch', { name: 'Show comparison period' }).click();
  await page.getByRole('switch', { name: 'Show data labels' }).click();
  await page.getByRole('button', { name: 'Save Report' }).click();
  await page.getByTestId('save-dialog').getByLabel('Report name').fill('Line View');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Report' }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  // RP-F06: it opens as it was saved, not with the page's defaults.
  await expect(settings.getByLabel('Chart Type')).toHaveValue('LINE');
  await expect(page.getByRole('switch', { name: 'Show comparison period' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Show data labels' })).toBeChecked();
  // RP-F13: its owner saves changes on the same report; Save As makes a new one.
  await settings.getByLabel('Chart Type').selectOption({ label: 'Area Chart' });
  const url = page.url();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole('button', { name: 'Save As' })).toBeVisible();

  // RP-F12: the library finds it by name, with its owner and status; RP-F03: Back comes here.
  // In mock mode a saved report lives in the page: go by its link, not a reload.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Saved Reports' })
    .click();
  await page.getByTestId('library-filters').getByLabel('Search').fill('Line View');
  await expect(page).toHaveURL(/q=Line\+View/);
  const table = page.getByRole('table', { name: 'Saved reports' });
  await expect(table).toContainText('Line View');
  await expect(table).toContainText('Active');
  await page.screenshot({ path: test.info().outputPath('library.png') });
  await table.getByRole('link', { name: 'Line View' }).click();
  await expect(settings.getByLabel('Chart Type')).toHaveValue('AREA');
  await page.screenshot({ path: test.info().outputPath('saved-report.png') });
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Report Library');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/reports\/library\?tab=saved&q=Line\+View$/);
  await expect(page.getByRole('tab', { name: 'Saved Reports' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('The overview’s range and comparison go to a report and come back; Custom Range says what is wrong (RP-F01, F16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.getByLabel('Date range', { exact: true }).selectOption('last_month');
  await expect(page).toHaveURL(/range=last_month/);
  await page.getByLabel('Compare to').selectOption('NONE');
  await expect(page).toHaveURL(/\/reports\?range=last_month&compare=NONE$/);
  await page.getByRole('link', { name: 'Revenue Summary' }).first().click();
  await expect(page).toHaveURL(/\/reports\/revenue-summary\?range=last_month&compare=NONE/);
  const filters = page.getByTestId('report-filters');
  await expect(filters.getByLabel('Date Range')).toHaveValue('last_month');
  await expect(filters.getByLabel('Compare To')).toHaveValue('NONE');
  await page.getByRole('link', { name: '← Back to Reports' }).click();
  await expect(page).toHaveURL(/\/reports\?range=last_month&compare=NONE$/);
  await expect(page.getByLabel('Date range', { exact: true })).toHaveValue('last_month');

  // RP-F16: the overview's Custom Range, reversed dates named in place.
  await page.getByLabel('Date range', { exact: true }).selectOption('custom');
  const custom = page.getByTestId('custom-range');
  await custom.getByLabel('From').fill('2026-10-26');
  await custom.getByLabel('To').fill('2026-10-24');
  await expect(custom.getByText('The start date must be on or before the end date.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('custom-range.png') });
  await custom.getByLabel('To').fill('2026-10-27');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/range=custom&start=2026-10-26&end=2026-10-27/);
  await expect(page.getByTestId('range')).toContainText('Oct 26, 2026');
});

test('Builder: Run Report opens the full report and Back finds the work; leaving asks first (RP-F05, F08, F14, F15)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // RP-F08: a KPI card opens its report.
  await page.goto(base);
  await page.getByTestId('kpi-link').first().click();
  await expect(page).toHaveURL(/\/reports\/[a-z-]+\?range=this_year/);

  await page.goto(`${base}/builder`);
  const step3 = page.getByTestId('step-3');
  await page.getByLabel('Report Name').fill('Big Invoices');
  await step3.getByRole('button', { name: 'Add Filter', exact: true }).click();
  // RP-F15: a new data source asks before it resets the filter; Cancel keeps everything.
  const source = page.getByTestId('step-1').getByLabel('Data Source');
  const before = await source.inputValue();
  await source.selectOption({ index: 1 });
  await expect(page.getByTestId('switch-resets')).toContainText('1 filters');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(source).toHaveValue(before);
  await expect(step3.getByTestId('filter-row-1')).toBeVisible();
  // RP-F05: leaving with unsaved work asks Save, Discard or Keep Editing.
  await page.getByRole('link', { name: '← Back to Reports' }).click();
  await expect(page.getByTestId('unsaved-keep')).toBeVisible();
  await page.getByTestId('unsaved-keep').click();
  await expect(page).toHaveURL(/\/reports\/builder/);
  // RP-F14: Run Report opens the full report of the unsaved definition, by its name.
  await step3.getByLabel('Field').selectOption({ label: 'Amount Collected' });
  await step3.getByLabel('Condition').selectOption({ label: 'Greater Than' });
  await step3.getByLabel('Value ($)').fill('500');
  await page.getByRole('button', { name: 'Run Report' }).click();
  await expect(page).toHaveURL(/\/reports\/custom\?d=/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Big Invoices');
  await expect(page.getByTestId('unsaved-note')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('run-report.png') });
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/reports\/builder\?d=/);
  await expect(page.getByLabel('Report Name')).toHaveValue('Big Invoices');
  await expect(step3.getByLabel('Value ($)')).toHaveValue('500');
});

test('Help icons explain each area, on press and with Escape (RP-F22)', async ({ page }) => {
  await page.goto(base);
  const about = (topic: string) => page.getByRole('button', { name: `About ${topic}` });
  await expect(about('Report cards')).toBeVisible();
  await expect(about('Date range and comparison')).toBeVisible();
  await expect(about('Report categories')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await about('Report cards').click();
  await expect(page.getByTestId('help-tip')).toContainText('Each card counts one thing');
  await page.screenshot({ path: test.info().outputPath('help-tip.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-tip')).toHaveCount(0);
  await page.goto(`${base}/revenue-summary`);
  for (const topic of ['Filters', 'The table', 'Export and print', 'Charts', 'Insights'])
    await expect(about(topic).first()).toBeVisible();
  await page.goto(`${base}/builder`);
  await expect(about('Fields, grouping and sorting').first()).toBeVisible();
  await page.goto(`${base}/library`);
  await expect(about('Saved reports and sharing')).toBeVisible();
});

test('Schedule shows the next run in the firm time zone, and revenue says what it counts (RP-F19, F21)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/revenue-summary`);
  // RP-F21: collected payments, said on the KPI.
  await expect(page.getByText('Total Amount Collected').first()).toBeVisible();
  // RP-F19: the next run, named with the zone and its offset, recomputed as the form changes.
  await page.getByRole('button', { name: 'Schedule Report' }).click();
  const dialog = page.getByTestId('schedule-dialog');
  await expect(page.getByRole('dialog')).toContainText(
    "The report runs in your firm's time zone, America/New_York.",
  );
  const next = dialog.getByTestId('next-run');
  await expect(next).toContainText(
    /Next run: Mon, \w{3} \d{1,2}, \d{4}, 8:00 AM E[SD]T \(America\/New_York, UTC−0[45]:00\)/,
  );
  await dialog.getByLabel('How often').selectOption('MONTHLY');
  await dialog.getByLabel('Day of the month').fill('32');
  await expect(next).toContainText('Choose a day of the month from 1 to 31.');
  await dialog.getByLabel('Day of the month').fill('15');
  await dialog.getByLabel('At', { exact: true }).fill('18:30');
  await expect(next).toContainText(/Next run: \w{3}, \w{3} 15, \d{4}, 6:30 PM E[SD]T/);
  await page.screenshot({ path: test.info().outputPath('schedule-next-run.png') });
});

test('A report shows as Table Only or KPI Only, as a line, without its legend; the builder keeps its display (RP-F18)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/revenue-summary`);
  const type = page.getByTestId('chart-type');
  await type.selectOption('TABLE');
  await expect(page.getByTestId('report-table')).toBeVisible();
  await expect(page.getByTestId('report-kpis')).toBeHidden();
  await expect(page.getByTestId('report-chart')).toBeHidden();
  await type.selectOption('KPI');
  await expect(page.getByTestId('report-kpis')).toBeVisible();
  await expect(page.getByTestId('report-table')).toBeHidden();
  await type.selectOption('LINE');
  await expect(page.getByTestId('chart-line')).toBeVisible();
  await expect(page.getByTestId('report-table')).toBeVisible();
  // The legend names this period and the comparison; it can be hidden.
  await expect(page.getByTestId('chart-legend')).toBeVisible();
  await page.getByRole('switch', { name: 'Show legend' }).click();
  await expect(page.getByTestId('chart-legend')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('line-chart.png') });

  // The builder's display travels with the report it runs.
  await page.goto(`${base}/builder`);
  await page.getByLabel('Report Name').fill('Payments table');
  await page.getByTestId('builder-display').selectOption('TABLE');
  await page.getByRole('button', { name: 'Run Report' }).click();
  await expect(page).toHaveURL(/\/reports\/custom\?d=/);
  await expect(page.getByTestId('report-table')).toBeVisible();
  await expect(page.getByTestId('report-kpis')).toBeHidden();
  await expect(page.getByTestId('chart-type')).toHaveValue('TABLE');
});

test('A row opens its record in the same tab, Back finds the report as left, and a row menu opens or copies (RP-F17)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/revenue-summary`);
  const table = page.getByTestId('report-table');
  // Page 2 of a search, then a row's invoice.
  await table.getByPlaceholder('Search results...').fill('INV-10');
  const link = table.getByTestId('row-link').first();
  await expect(link).toHaveText(/^INV-10/);
  const onPage1 = (await link.textContent()) ?? '';
  await table.getByRole('button', { name: 'Page 2' }).click();
  await expect(link).not.toHaveText(onPage1);
  const number = (await link.textContent()) ?? '';
  expect(number).toMatch(/^INV-10/);
  // The row menu: open the invoice, or copy its number.
  await table.getByRole('button', { name: `Actions for ${number}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Open invoice' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy Invoice' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('row-menu.png') });
  await page.keyboard.press('Escape');
  await link.click();
  await expect(page).toHaveURL(/\/invoices\/0199c3a0-0000-7000-8000-/);
  // Back: the same search, page and row.
  await page.goBack();
  await expect(page).toHaveURL(/\/reports\/revenue-summary\?.*view=/);
  await expect(table.getByPlaceholder('Search results...')).toHaveValue('INV-10');
  await expect(table.getByTestId('row-link').first()).toHaveText(number);
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  for (const path of ['', '/revenue-summary', '/builder', '/library']) {
    await page.goto(`${base}${path}`);
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
});
