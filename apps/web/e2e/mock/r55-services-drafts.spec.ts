import { expect, test } from '@playwright/test';

// R55: Octavia's Services & Pricing review of Oct 20, S2. Save as Draft keeps unfinished work (no
// category, short description or price), and Save & Activate names each missing field. S4's
// Packages views are r56-services-pricing-review's. In mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('S2: a draft saves with only its name; Save & Activate names what is missing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/services-pricing/new'));
  await page.getByTestId('service-name').fill('Fake Unfinished Service');
  await expect(page.getByTestId('draft-note')).toContainText('needed to activate');

  // Activating needs the category and short description: each is named on its field.
  await page.getByTestId('save-activate').click();
  await expect(page.getByTestId('service-category')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Short Description *')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Choose a category')).toBeVisible();
  await page.screenshot({ path: 'test-results/r55-services-drafts-1440.png', fullPage: true });

  // As a draft it saves, and it is listed under Drafts.
  await page.getByTestId('save-draft').click();
  await expect(page).toHaveURL(/\/services-pricing$/);
  await page
    .getByTestId('service-views')
    .getByRole('button', { name: /^Drafts/ })
    .click();
  await expect(page.getByText('Fake Unfinished Service')).toBeVisible();
});
