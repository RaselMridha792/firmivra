// Payroll F01 (R61's live check): one provider state, the same words in the Connected Payroll
// Providers panel, the client's Overview and its Upcoming Payroll Runs. Mock mode, as an Owner:
// Gusto has synced (Green Leaf Café), QuickBooks Payroll is authorized with no data yet (Davis
// Consulting), and OnPay is chosen but not authorized (Jordan Services). Roberts & Co. has no
// provider and no run, so its Upcoming Payroll Runs show the schedule or what is missing.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const SEARCH = 'Search clients, business name, or EIN...';

/** The providers panel's state for one provider. */
const panelState = (page: Page, provider: string) =>
  page.getByTestId('card-providers').getByRole('listitem').filter({ hasText: provider });

/** Open a client of the list by name (in-app, so the mock keeps what was done). */
async function openClient(page: Page, name: string) {
  await page.getByPlaceholder(SEARCH).fill(name);
  await page.getByTestId('client-link').filter({ hasText: name }).click();
  await expect(page.getByTestId('stat-provider')).toBeVisible();
}

/** Connect Payroll Provider for Roberts & Co. */
async function connectRoberts(page: Page, provider: string) {
  await page.getByRole('button', { name: 'Connect Payroll Provider' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect Payroll Provider' });
  await dialog.getByLabel('Payroll client').selectOption({ label: 'Roberts & Co.' });
  await dialog.getByLabel('Payroll provider').selectOption({ label: provider });
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toHaveCount(0);
}

test('F01 synced: the panel and the client both say "Connected · last sync"', async ({ page }) => {
  await page.goto(`${app}/payroll`);
  await expect(panelState(page, 'Gusto')).toContainText('Connected · last sync');
  await openClient(page, 'Green Leaf');
  await expect(page.getByTestId('provider-sync')).toContainText('Connected · last sync');
});

test('F01 authorized, never synced: "Connected · waiting for first sync", and the next pay date with first sync pending', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  const waiting = 'Connected · waiting for first sync';
  await expect(panelState(page, 'QuickBooks Payroll')).toContainText(waiting);
  await connectRoberts(page, 'QuickBooks Payroll');
  await expect(panelState(page, 'QuickBooks Payroll')).toContainText(waiting);
  await openClient(page, 'Roberts');
  await expect(page.getByTestId('provider-sync')).toContainText(waiting);
  // Monthly is set and the provider is authorized: the schedule, not a prompt.
  const upcoming = page.getByRole('region', { name: 'Upcoming Payroll Runs' });
  await expect(upcoming).toContainText(/Next payroll [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(upcoming).toContainText('Monthly · first sync pending');
  await expect(upcoming).not.toContainText('Set a frequency');
});

test('F01 chosen, not authorized: "Pending setup" everywhere, and only that is asked for', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await expect(panelState(page, 'OnPay')).toContainText('Pending setup');
  await connectRoberts(page, 'OnPay');
  await openClient(page, 'Roberts');
  await expect(page.getByTestId('provider-sync')).toContainText('Pending setup');
  const upcoming = page.getByRole('region', { name: 'Upcoming Payroll Runs' });
  await expect(upcoming).toContainText('To see the schedule, connect OnPay in Integrations.');
  await expect(upcoming).not.toContainText('pay frequency');
});

test('F01 plan: Change Payroll Plan opens on the saved plan, and No plan is an explicit removal', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await openClient(page, 'Green Leaf');
  const menu = async () => {
    await page.getByRole('button', { name: 'Client Actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Change Payroll Plan/Service' }).click();
    return page.getByRole('dialog', { name: 'Change Payroll Plan / Service' });
  };
  let dialog = await menu();
  const select = dialog.getByLabel('Plan or service');
  await expect(select).toBeEnabled();
  const plan = (await select.locator('option').nth(1).innerText()).trim();
  await select.selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Plan saved.')).toBeVisible();

  // Opened again: on the saved plan, never "No plan".
  dialog = await menu();
  await expect(dialog.getByLabel('Plan or service').locator('option:checked')).toHaveText(plan);
  // Choosing No plan removes it, on purpose.
  await dialog.getByLabel('Plan or service').selectOption({ value: '' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Plan saved.')).toBeVisible();
  dialog = await menu();
  await expect(dialog.getByLabel('Plan or service').locator('option:checked')).toHaveText(
    'No plan',
  );
});
