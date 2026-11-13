import { expect, test, type Page } from '@playwright/test';

// R60, Clients: Octavia's approved additions (Oct 25 review). Added Last 30 Days (the creation
// date; New stays the stage) and the Archived Clients shortcut (the Records filter) are tabs;
// More Filters gains the deadline, next appointment, client type, location, balance, missing
// documents, tags, source and priority, applied with Apply Filters, cleared with Clear Filters,
// and each shown as a removable chip. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-clients-filters';

test.describe.configure({ timeout: 180_000 });

const names = (page: Page) => page.getByTestId('clients-table').getByTestId('client-link');
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Client views' }).getByRole('tab', { name: new RegExp(name) });

test('Added Last 30 Days and Archived are views of their own', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients?new=1'));
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Full name *').fill('Newly Added (fake)');
  await dialog.getByLabel('Email *').fill('newly@example.test');
  await dialog.getByLabel('Phone *').fill('404 555 0150');
  await dialog.getByLabel('Street address *').fill('5 New Street');
  await dialog.getByLabel('City *').fill('Atlanta');
  await dialog.getByLabel('State *').selectOption('GA');
  await dialog.getByLabel('ZIP code *').fill('30303');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Newly Added (fake)', {
    timeout: 60_000,
  });
  await page.getByRole('link', { name: 'Clients', exact: true }).last().click();
  await expect(names(page).first()).toBeVisible({ timeout: 60_000 });

  await tab(page, 'Added Last 30 Days').click();
  await expect(names(page)).toHaveText(['Newly Added (fake)']);
  await expect(page.getByTestId('filter-chips')).toContainText('Added since');

  await tab(page, 'Archived').click();
  await expect(names(page)).toHaveText(['Pat Archived']);
  await expect(page.getByTestId('filter-chips')).toContainText('Archived');
  await page.screenshot({ path: `${shots}/archived.png` });
  // Back to the other views: current clients again.
  await tab(page, 'All Clients').click();
  await expect(names(page)).not.toContainText(['Pat Archived']);
});

test('More Filters applies with Apply, shows chips, and clears', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(names(page).first()).toBeVisible({ timeout: 60_000 });
  const all = await names(page).count();

  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByRole('radio', { name: 'Business', exact: true }).check();
  await page.getByRole('radio', { name: 'Balance due', exact: true }).check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/more-filters.png` });
  // Nothing changes until Apply Filters.
  await expect(names(page)).toHaveCount(all);
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(names(page)).toHaveText(['Acme Widgets LLC (fake)']);
  const chips = page.getByTestId('filter-chips');
  await expect(chips).toContainText('Business');
  await expect(chips).toContainText('Balance due');
  await page.screenshot({ path: `${shots}/chips.png` });

  // A chip removes its own filter.
  await page.getByRole('button', { name: 'Remove Balance due' }).click();
  await expect(chips).not.toContainText('Balance due');
  await expect(names(page)).toContainText(['Northwind Bakery LLC (fake)']);
  // The address keeps the filters (Return to Clients and Back bring them back).
  await expect(page).toHaveURL(/type=BUSINESS/);

  // Clear Filters clears them all.
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByTestId('filter-chips')).toHaveCount(0);
  await expect(names(page)).toHaveCount(all);
});
