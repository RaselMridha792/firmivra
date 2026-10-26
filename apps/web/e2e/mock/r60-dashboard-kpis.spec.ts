import { expect, type Page, test } from '@playwright/test';

// Octavia's Dashboard review of Oct 24 (K2 to K7): each KPI card opens the list filtered to what
// it counts, and the list offers Back to Dashboard. Mock mode (playwright.mock.config.ts) as the
// Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const card = (page: Page, label: string) => page.getByTestId('kpi-card').filter({ hasText: label });

async function openDashboard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await expect(page.getByTestId('kpi-card')).toHaveCount(6, { timeout: 60_000 });
}

async function backToDashboard(page: Page) {
  await page.getByTestId('back-to-dashboard').click();
  await expect(page).toHaveURL(app('/'));
  await expect(page.getByTestId('kpi-card')).toHaveCount(6);
}

test('each card opens its list filtered to what it counts', async ({ page }) => {
  await openDashboard(page);
  const month = /from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&back=dashboard$/;
  await expect(card(page, 'New Leads')).toHaveAttribute('href', /^\/leads\?stage=SUBMITTED&/);
  await expect(card(page, 'New Leads')).toHaveAttribute('href', month);
  await expect(card(page, 'Returns In Progress')).toHaveAttribute(
    'href',
    '/tax-returns?status=IN_PROGRESS&back=dashboard',
  );
  await expect(card(page, 'Accepted Returns')).toHaveAttribute(
    'href',
    /^\/tax-returns\?status=ACCEPTED&acceptedFrom=\d{4}-\d{2}-01&acceptedTo=\d{4}-\d{2}-\d{2}&back=dashboard$/,
  );
  await expect(page.getByText('Completed Returns')).toHaveCount(0);
  await expect(card(page, 'Outstanding Invoices')).toHaveAttribute(
    'href',
    '/invoices?status=OUTSTANDING&back=dashboard',
  );
  await expect(card(page, 'Total Clients')).toHaveAttribute('href', '/clients?back=dashboard');
});

test('New Leads: Leads at New Lead for this month, then Back to Dashboard', async ({ page }) => {
  await openDashboard(page);
  await card(page, 'New Leads').click();
  await expect(page.getByTestId('page-title')).toHaveText('Leads', { timeout: 60_000 });
  await expect(page.getByRole('combobox', { name: 'All Lead Statuses' })).toHaveValue('SUBMITTED');
  await backToDashboard(page);
});

test('Returns In Progress and Accepted Returns open Tax Returns with those filters', async ({
  page,
}) => {
  await openDashboard(page);
  await card(page, 'Returns In Progress').click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('IN_PROGRESS', {
    timeout: 60_000,
  });
  await backToDashboard(page);

  await card(page, 'Accepted Returns').click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('ACCEPTED', {
    timeout: 60_000,
  });
  const accepted = page.getByTestId('accepted-filter');
  await expect(accepted).toContainText('Accepted');
  await accepted.getByRole('button', { name: 'Clear the accepted dates' }).click();
  await expect(accepted).toHaveCount(0);
});

test('Outstanding Invoices lists every unpaid invoice with its total', async ({ page }) => {
  await openDashboard(page);
  await card(page, 'Outstanding Invoices').click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('OUTSTANDING', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('outstanding-total')).toContainText('outstanding');
  await backToDashboard(page);
});

test('Appointments Today and View Calendar open today’s appointments', async ({ page }) => {
  await openDashboard(page);
  await card(page, 'Appointments Today').getByRole('link', { name: 'View Calendar' }).click();
  await expect(page).toHaveURL(/\/calendar\/today\?back=dashboard$/, { timeout: 60_000 });
  await expect(page.getByTestId('today-schedule')).toBeVisible();
  await backToDashboard(page);
});
