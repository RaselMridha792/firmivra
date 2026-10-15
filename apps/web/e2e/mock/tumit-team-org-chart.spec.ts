import { expect, test } from '@playwright/test';

// Teams & Departments, Org Chart tab, in mock mode (playwright.mock.config.ts). The mock's eight
// active people report to Morgan Avery, except Daniel Okafor, who reports to Lena Fischer.
// Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/org-chart`;

test('draws the reporting lines and opens a person', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Teams & departments: Org chart');
  await expect(page.getByRole('link', { name: 'Org Chart', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const people = page.getByTestId('org-person');
  await expect(people).toHaveCount(8);
  await expect(page.getByTestId('org-count')).toHaveText('8 active people');

  const details = page.getByTestId('person-details');
  await expect(details).toContainText('Morgan Avery');
  await expect(details).toContainText('No one: top of the chart');

  // Daniel reports to Lena; her name in the panel opens her.
  await people.filter({ hasText: 'Daniel Okafor' }).click();
  await expect(details).toContainText('Daniel Okafor');
  await expect(details).toContainText('Lena Fischer');
  await details.getByRole('button', { name: /Lena Fischer/ }).click();
  await expect(details.getByText('Daniel Okafor')).toBeVisible();
  await expect(details.getByRole('link', { name: 'View Profile' })).toHaveAttribute(
    'href',
    /^\/team\/[0-9a-f-]{36}$/,
  );

  // Hide and show the people under Lena.
  await page.getByRole('button', { name: 'Hide the people who report to Lena Fischer' }).click();
  await expect(people).toHaveCount(7);
  await page.getByRole('button', { name: 'Show the people who report to Lena Fischer' }).click();
  await expect(people).toHaveCount(8);
});

test('search and the department filter keep each match with the people above it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const people = page.getByTestId('org-person');
  await expect(people).toHaveCount(8);

  await page.getByLabel('Search people').fill('daniel');
  await expect(people).toHaveCount(3);
  await expect(page.getByTestId('org-count')).toHaveText('1 of 8 people match');
  await expect(page.getByTestId('person-details')).toContainText('Daniel Okafor');

  await page.getByLabel('Search people').fill('');
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Payroll' });
  await expect(people).toHaveCount(3);
  await expect(page.getByTestId('org-count')).toHaveText('2 of 8 people match');

  await page.getByLabel('Search people').fill('nobody here');
  await expect(people).toHaveCount(0);
  await expect(page.getByText('No matching people')).toBeVisible();
});
