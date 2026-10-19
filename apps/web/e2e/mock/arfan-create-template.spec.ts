import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/templates/new`;

test('renders Create Template in data, empty, API-unavailable, and mobile states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(url);

  await expect(page).toHaveTitle('Create template');
  await expect(page.getByRole('heading', { name: 'Create Template', level: 1 })).toBeVisible();
  // R56: a new template starts blank (nothing seeded); categories and merge fields are the API's.
  await expect(page.getByRole('textbox', { name: 'Template Name *' })).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email Preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Available Merge Fields' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Insert Image' })).toHaveCount(0);
  const mergeFieldButtons = page.getByRole('button', { name: 'Insert Merge Field', exact: true });
  const mergeFieldMenu = page.getByTestId('template-merge-field-menu');
  await mergeFieldButtons.nth(0).click();
  await expect(mergeFieldMenu).toHaveCount(1);
  await expect(mergeFieldButtons.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await mergeFieldButtons.nth(1).click();
  await expect(mergeFieldMenu).toHaveCount(1);
  await expect(mergeFieldButtons.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(mergeFieldButtons.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await mergeFieldButtons.nth(1).click();
  await expect(mergeFieldMenu).toHaveCount(0);
  await page.getByRole('button', { name: 'Insert image' }).click();
  await expect(page.getByRole('dialog', { name: 'Insert Image' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('create-template-data-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  const statusButton = page.getByRole('button', { name: 'Status', exact: true });
  const statusMenu = page.getByRole('listbox', { name: 'Status options' });
  await statusButton.click();
  await expect(page.getByRole('dialog', { name: 'Insert Image' })).toHaveCount(0);
  await expect(statusMenu).toBeVisible();
  await expect(page.getByRole('option', { name: 'Inactive' })).toBeVisible();
  await page.getByRole('heading', { name: 'Create Template' }).click();
  await expect(statusMenu).toHaveCount(0);
  await statusButton.click();
  await page.getByRole('option', { name: 'Inactive' }).click();
  await expect(statusButton).toContainText('Inactive');

  await page.getByRole('button', { name: 'SMS' }).click();
  await expect(page.getByRole('heading', { name: 'SMS Preview' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Subject *' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Email', exact: true }).click();

  // The library is the communications media library (B6): empty in the mock.
  await page.getByRole('button', { name: 'Insert image' }).click();
  await page.getByRole('tab', { name: 'Choose from Library' }).click();
  await expect(page.getByText('No images in the library yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert Image', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close image dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Insert Image' })).toHaveCount(0);

  await page.goto(`${url}?mockState=empty`);
  await expect(page.getByTestId('template-empty-state')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Template Name *' })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Email Preview' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('create-template-empty-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await expect(page.getByRole('dialog', { name: 'Insert Image' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Email Preview' })).toBeVisible();
  const width = await page.locator('body').evaluate((element) => element.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: test.info().outputPath('create-template-mobile-375.png'),
    animations: 'disabled',
    fullPage: true,
  });
});
