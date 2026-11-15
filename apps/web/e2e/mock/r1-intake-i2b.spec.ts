import { expect, test, type Locator } from '@playwright/test';

// Intake Forms Review Two I2b in mock mode: 18d (the detail's Overview shows the sections of the
// version the form was sent with) and INTAKE-DESIGN-01 to 03 at the reviewer's 1165-pixel desktop
// width. Form 3 was sent with the Annual Tax form, form 10 with the Payroll form.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const form = (n: number) =>
  `${app}/intake-forms/0199c0d0-0a00-7000-8000-${String(n).padStart(12, '0')}`;
const WIDTH = 1165;

const inView = async (locator: Locator) => {
  const box = await locator.boundingBox();
  const width = locator.page().viewportSize()!.width;
  return !!box && box.x >= 0 && box.x + box.width <= width;
};

test('18d: the Overview shows the sections of the form version it was sent with', async ({
  page,
}) => {
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.goto(form(10));
  await expect(page.getByTestId('client-card')).toContainText('Payroll Setup Form');
  // The Payroll form's own sections, answered or waiting; none of the tax form's cards.
  await expect(page.getByTestId('card-business')).toContainText('Pruitt Garden Supply (sample)');
  await expect(page.getByTestId('card-employees')).toContainText('12');
  await expect(page.getByTestId('card-unanswered')).toContainText('Payroll Schedule & Timing');
  for (const tax of ['card-personal', 'card-dependents', 'card-income', 'card-deductions']) {
    await expect(page.getByTestId(tax)).toHaveCount(0);
  }
  await page.screenshot({ path: test.info().outputPath('overview-payroll.png'), fullPage: true });

  // The tax form's cards, each a summary; the rest is on Responses.
  await page.goto(form(3));
  await expect(page.getByTestId('card-personal')).toContainText('XXX-XX-4821');
  await expect(page.getByTestId('card-personal-more')).toContainText('on the Responses tab');
  await expect(page.getByTestId('card-dependents')).toContainText('Marcus');
  await page.getByRole('link', { name: 'See every answer on the Responses tab' }).click();
  await expect(page).toHaveURL(/\/responses$/);
  await expect(page.getByTestId('section-personal')).toContainText('Filing Status');
});

test('DESIGN-01: the client summary is compact and keeps every detail readable', async ({
  page,
}) => {
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.goto(form(3));
  const card = page.getByTestId('client-card');
  for (const label of [
    'Bruno Sandoval',
    'Form Name',
    'Service',
    'Status',
    'Date Sent',
    'Due Date',
    'Expires',
    'Submitted',
    'Assigned To',
  ]) {
    await expect(card).toContainText(label);
  }
  // Two rows at this width (five before), so the tabs sit high on the page.
  expect((await card.boundingBox())!.height).toBeLessThan(200);
  // Nothing cut short: the name and the email show in full.
  for (const text of ['Bruno Sandoval', 'bruno@example.test']) {
    const el = card.getByText(text, { exact: true });
    await expect(el).toBeVisible();
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBeTruthy();
  }
  await card.screenshot({ path: test.info().outputPath('client-summary.png') });
});

test('DESIGN-02 and 03: the list fits its rows, keeps 8/12/24 per page and its Actions in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.goto(`${app}/intake-forms`);
  const table = page.getByRole('table', { name: 'Client intake forms' });
  await expect(table.getByRole('row')).toHaveCount(9);
  const perPage = page.getByRole('navigation', { name: 'Pagination' }).getByRole('combobox');
  await expect(perPage).toBeVisible();
  await expect(perPage.getByRole('option')).toHaveText(['8', '12', '24']);

  // DESIGN-03: Actions stay at the right edge while the other columns scroll.
  const actions = page.getByRole('columnheader', { name: 'Actions' });
  const first = table.getByRole('button', { name: /^Actions for / }).first();
  await expect(actions).toBeVisible();
  expect(await inView(actions)).toBeTruthy();
  expect(await inView(first)).toBeTruthy();
  const scroller = table.locator('xpath=..');
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBeTruthy();
  await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  expect(await inView(first)).toBeTruthy();
  await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
  expect(await inView(first)).toBeTruthy();
  await first.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath('list-1165.png'), fullPage: true });

  // DESIGN-02: one result leaves no tall blank column beside the list; 8/12/24 stay.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByPlaceholder('Search forms...').fill('Bruno');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(perPage).toBeVisible();
  const chart = (await page.getByTestId('intake-form-status-chart').boundingBox())!;
  expect(chart.height).toBeLessThan(330);
  await page.screenshot({ path: test.info().outputPath('list-1440-one.png'), fullPage: true });
});
