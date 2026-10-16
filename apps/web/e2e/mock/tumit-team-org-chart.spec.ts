import { expect, test } from '@playwright/test';

// Teams & Departments, Org Chart tab, in mock mode (playwright.mock.config.ts). The mock's eight
// active people report to Morgan Avery, except Daniel Okafor, who reports to Lena Fischer.
// Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/org-chart`;

test('draws the reporting lines and moves through them from Person Details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Teams & departments: Org chart');
  await expect(page.getByRole('link', { name: 'Org Chart', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const chart = page.getByTestId('org-chart');
  await expect(page.getByRole('list', { name: 'Organization chart' })).toBeVisible();
  for (const name of ['Morgan Avery', 'Lena Fischer', 'Daniel Okafor', 'Theo Grant']) {
    await expect(chart).toContainText(name);
  }
  await expect(chart).toContainText('Head of Tax');
  await expect(page.getByTestId('org-count')).toHaveText('8 active people');

  // The top person opens first; their reports and boss open from the panel.
  const details = page.getByTestId('person-details');
  await expect(details).toContainText('Morgan Avery');
  await expect(details).toContainText('No one: top of the chart');
  await details.getByRole('button', { name: 'Lena Fischer' }).click();
  await expect(details.getByRole('button', { name: 'Daniel Okafor' })).toBeVisible();
  await details.getByRole('button', { name: 'Daniel Okafor' }).click();
  await expect(details).toContainText('Tax Preparer');
  await details.getByRole('button', { name: /Lena Fischer/ }).click();
  await expect(details).toContainText('Tax Manager');
  await expect(details.getByRole('link', { name: 'View Profile' })).toHaveAttribute(
    'href',
    /^\/team\/[0-9a-f-]{36}$/,
  );
});

test('search and the department filter keep each match with the people above it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const chart = page.getByTestId('org-chart');
  await expect(page.getByTestId('org-count')).toHaveText('8 active people');

  await page.getByLabel('Search people').fill('daniel');
  await expect(page.getByTestId('org-count')).toHaveText('1 of 8 people match');
  await expect(chart).toContainText('Morgan Avery');
  await expect(chart).toContainText('Lena Fischer');
  await expect(chart).not.toContainText('Theo Grant');
  await expect(page.getByTestId('person-details')).toContainText('Daniel Okafor');

  await page.getByLabel('Search people').fill('');
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Payroll' });
  await expect(page.getByTestId('org-count')).toHaveText('2 of 8 people match');
  await expect(chart).toContainText('Rosa Delgado');
  await expect(chart).not.toContainText('Daniel Okafor');

  await page.getByLabel('Search people').fill('nobody here');
  await expect(chart).toContainText('No matching people');
  // The card keeps its frame with a quiet line (design-match rule 2).
  await expect(page.getByTestId('person-details')).toContainText('No one matches.');
});
