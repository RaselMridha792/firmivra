import { expect, test, type Page } from '@playwright/test';

// Dashboard Review 2 V6 (R1): each widget's own error state. In mock mode a call named in
// sessionStorage `fv-mock-fail` answers 500 (lib/mock.ts `failable`): the widgets it feeds show
// their error with Try again, the other widgets still show, and Try again recovers once the call
// works again.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const home = `http://app.localhost:${port}/`;

const SUMMARY_WIDGETS = ['Client Pipeline', 'Revenue Overview', 'Service Breakdown', 'Tasks Due'];

const failing = async (page: Page, calls: string) => {
  await page.addInitScript((v) => window.sessionStorage.setItem('fv-mock-fail', v), calls);
  await page.goto(home);
};
/** The call works again (the page is not reloaded, so the init script does not set it back). */
const heal = (page: Page) => page.evaluate(() => window.sessionStorage.removeItem('fv-mock-fail'));
const widget = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const broken = async (page: Page, name: string) => {
  await expect(widget(page, name).getByRole('alert')).toBeVisible();
  await expect(widget(page, name).getByRole('button', { name: 'Try again' })).toBeVisible();
};
const working = async (page: Page, name: string) => {
  await expect(widget(page, name)).toBeVisible();
  await expect(widget(page, name).getByRole('alert')).toHaveCount(0);
};

test('the summary fails: the KPI row and the four widgets it feeds say so; messages and appointments still show', async ({
  page,
}) => {
  await failing(page, 'dashboard.summary');
  const kpis = page.getByTestId('kpi-error');
  await expect(kpis).toContainText('The numbers could not be loaded.');
  for (const name of SUMMARY_WIDGETS) await broken(page, name);
  await working(page, 'Recent Messages');
  await working(page, 'Upcoming Appointments');
  // No endless skeletons: every KPI card shows a dash.
  await expect(page.getByTestId('kpi-card').first()).toContainText('—');

  await heal(page);
  await kpis.getByRole('button', { name: 'Try again' }).click();
  await expect(kpis).toHaveCount(0);
  for (const name of SUMMARY_WIDGETS) await working(page, name);
});

test('the messages call fails: only Recent Messages says so, and Try again recovers', async ({
  page,
}) => {
  await failing(page, 'messages.inbox');
  await broken(page, 'Recent Messages');
  await working(page, 'Upcoming Appointments');
  await working(page, 'Tasks Due');
  await expect(page.getByTestId('kpi-error')).toHaveCount(0);

  await heal(page);
  await widget(page, 'Recent Messages').getByRole('button', { name: 'Try again' }).click();
  await working(page, 'Recent Messages');
});

test('the appointments call fails: only Upcoming Appointments says so, and Try again recovers', async ({
  page,
}) => {
  await failing(page, 'appointments.list');
  await broken(page, 'Upcoming Appointments');
  await working(page, 'Recent Messages');
  await working(page, 'Client Pipeline');
  await expect(page.getByTestId('kpi-error')).toHaveCount(0);

  await heal(page);
  await widget(page, 'Upcoming Appointments').getByRole('button', { name: 'Try again' }).click();
  await working(page, 'Upcoming Appointments');
});

test("the firm's time zone fails: messages and appointments wait with Try again; the numbers still show", async ({
  page,
}) => {
  await failing(page, 'availability.get');
  const lists = page.getByText("We couldn't load messages and appointments.");
  await expect(lists).toBeVisible();
  await working(page, 'Client Pipeline');
  await expect(page.getByTestId('kpi-error')).toHaveCount(0);

  await heal(page);
  await page
    .getByRole('alert')
    .filter({ hasText: "We couldn't load messages" })
    .getByRole('button', { name: 'Try again' })
    .click();
  await working(page, 'Recent Messages');
  await working(page, 'Upcoming Appointments');
});
