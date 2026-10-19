import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/templates/template-1/edit`;

test('edits a template with data, empty, unavailable, and mobile states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(url);

  await expect(page).toHaveTitle('Edit template');
  await expect(page.getByTestId('edit-template-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit Template', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Template Name *' })).toHaveValue(
    'Welcome to Firmivra',
  );
  await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('Onboarding');
  await expect(page.getByRole('textbox', { name: 'Subject *' })).toHaveValue(
    'Welcome to Firmivra!',
  );
  await expect(page.getByRole('textbox', { name: 'Message Body *' })).toContainText(
    'Hi {{contact_name}},',
  );
  await expect(page.getByRole('list', { name: 'Selected attachments' })).toContainText(
    'welcome-guide.pdf',
  );
  await expect(page.getByRole('button', { name: 'Save Template' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('edit-template-data-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=empty`);
  await expect(page.getByTestId('edit-template-empty-state')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Template Name *' })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Email Preview' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('edit-template-empty-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto(`${url}?mockState=api-unavailable`);
  await expect(page.getByTestId('template-api-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Available Merge Fields' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('edit-template-api-unavailable-1440.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Edit Template', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email Preview' })).toBeVisible();
  const bodyWidth = await page.locator('body').evaluate((element) => element.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: test.info().outputPath('edit-template-data-375.png'),
    animations: 'disabled',
    fullPage: true,
  });
});
