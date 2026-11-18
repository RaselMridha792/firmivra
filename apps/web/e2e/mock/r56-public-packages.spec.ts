import { expect, test, type Page } from '@playwright/test';

// Client Portal Review One SP-1 (Services & Pricing S7, S12): a package's booking link on its
// detail page (Copy link and the website button), and the page behind it in the portal: what the
// package includes, what it does not include, its price and add-ons; a package the firm does not
// show online, or no package at all, is refused with the firm's contact. The public package API
// is served by route; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const PACKAGE = '0199c0e0-0f00-7000-8000-000000000001';
const HIDDEN = '0199c0e0-0f00-7000-8000-000000000002';
const GONE = '0199c0e0-0f00-7000-8000-000000000003';

async function servePackages(page: Page) {
  await page.route('**/api/v1/portal/lvp/packages/**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    if (id === PACKAGE)
      return route.fulfill({
        json: {
          id,
          state: 'LIVE',
          details: {
            name: 'Small Business Tax Bundle (fake)',
            shortDescription: 'Essential tax and compliance services for new businesses.',
            category: 'Business Tax',
            packagePriceCents: 120_000,
            savingsCents: 30_000,
            included: [{ name: 'Business tax return' }, { name: 'Quarterly estimates' }],
            notIncluded: [{ name: 'Audit defense' }],
            addOns: [{ name: 'Rush filing', description: 'Filed in 3 days.', priceCents: 7_500 }],
          },
        },
      });
    if (id === HIDDEN) return route.fulfill({ json: { id, state: 'HIDDEN', details: null } });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    });
  });
}

test('SP-1: the package detail page offers its booking link and website button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/services-pricing/packages/${PACKAGE}`));
  const block = page.getByTestId('detail-link');
  await expect(block).toContainText('Booking Link', { timeout: 60_000 });
  await expect(block.getByLabel('Link', { exact: true })).toHaveValue(
    new RegExp(`/lvp/packages/${PACKAGE}$`),
  );
  await expect(block.getByRole('button', { name: /Copy Booking Link/ })).toBeVisible();
});

test('SP-1: a live package’s page shows what it includes and does not, its price and add-ons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await servePackages(page);
  await page.goto(portal(`/lvp/packages/${PACKAGE}`));
  const view = page.getByTestId('package-link');
  await expect(view.getByRole('heading', { name: 'Small Business Tax Bundle (fake)' })).toBeVisible(
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('package-price')).toContainText('Price$1,200.00');
  await expect(page.getByTestId('package-price')).toContainText('You save$300.00');
  await expect(page.getByTestId('package-included').getByRole('listitem')).toHaveText([
    'Business tax return',
    'Quarterly estimates',
  ]);
  await expect(page.getByTestId('package-not-included').getByRole('listitem')).toHaveText([
    'Audit defense',
  ]);
  await expect(page.getByTestId('package-add-ons')).toContainText('Rush filing');
  await expect(page.getByTestId('package-add-ons')).toContainText('+ $75.00');
  await expect(view.getByRole('link', { name: 'Sign In to Get Started' })).toHaveAttribute(
    'href',
    '/lvp/sign-in',
  );
});

test('SP-1: a package not shown online, or no package, is refused with the firm’s contact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await servePackages(page);
  await page.goto(portal(`/lvp/packages/${HIDDEN}`));
  const refused = page.getByTestId('package-link-refused');
  await expect(refused).toContainText('This Package Isn’t Available Online', { timeout: 60_000 });
  await expect(page.getByTestId('package-included')).toHaveCount(0);
  await page.goto(portal(`/lvp/packages/${GONE}`));
  await expect(page.getByTestId('package-link-refused')).toContainText(
    'This Package Link Does Not Work',
    { timeout: 60_000 },
  );
});
