import { expect, type Page, test } from '@playwright/test';

// Services & Pricing S12 (decided Nov 19), in mock mode (playwright.mock.config.ts): a package's
// optional Booking type, one of the firm's appointment types. The firm picks it in the package
// builder and sees it on the package; the package's public page then has Book, which opens that
// type's booking link with the package carried through sign-in to the booking. With no Booking
// type the page keeps its sign-in path (r56-public-packages.spec.ts). The public package API is
// served by route; the mock types (mocks/appointments.ts): 1 Tax consultation takes bookings,
// 3 Internal planning is not booked online. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const TAX = '0199b6c2-0000-7000-8000-000000000001';
const BUNDLE = '0199c0e0-0f00-7000-8000-000000000001';

/** A client-side move inside the portal, so the mock's signed-out session lasts. */
async function moveTo(page: Page, path: string) {
  await page.evaluate((to) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(
      to,
    );
  }, path);
}

async function signOut(page: Page) {
  await page.goto(portal('/lvp/home'));
  await page.getByRole('button', { name: /Client/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-in'));
}

test('S12: the firm picks a package’s Booking type and sees it on the package', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/services-pricing/packages/${BUNDLE}/edit`));
  const select = page.getByTestId('package-booking-type');
  await expect(select.getByRole('option', { name: 'Tax consultation' })).toBeAttached({
    timeout: 60_000,
  });
  await expect(select).toHaveValue('');
  await expect(
    select.getByRole('option', { name: 'Internal planning (not booked online)' }),
  ).toBeAttached();
  await expect(select.getByRole('option', { name: /Old intake call/ })).toHaveCount(0);
  await select.selectOption({ label: 'Tax consultation' });
  await expect(page.getByTestId('builder-settings')).toContainText(
    'The package page’s Book opens this appointment’s booking.',
  );
  await page.getByTestId('builder-settings').screenshot({
    path: testInfo.outputPath('booking-type-select.png'),
  });
  await page.getByTestId('package-save').click();
  await expect(page).toHaveURL(app(`/services-pricing/packages/${BUNDLE}`));
  await expect(page.getByTestId('detail-booking-type')).toHaveText('Tax consultation');
});

test('S12: Book opens the type’s booking, and the package goes with it through sign-in', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/portal/lvp/packages/**', (route) =>
    route.fulfill({
      json: {
        id: BUNDLE,
        state: 'LIVE',
        details: {
          name: 'Small Business Tax Bundle (fake)',
          shortDescription: 'Essential tax and compliance services for new businesses.',
          category: 'Business Tax',
          packagePriceCents: 120_000,
          savingsCents: null,
          included: [{ name: 'Business tax return' }],
          notIncluded: [],
          addOns: [],
          bookingTypeId: TAX,
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signOut(page);
  await moveTo(page, `/lvp/packages/${BUNDLE}`);
  const view = page.getByTestId('package-link');
  const book = view.getByRole('link', { name: 'Book This Package' });
  await expect(book).toHaveAttribute('href', `/lvp/book/${TAX}?package=${BUNDLE}`);
  await expect(view.getByRole('link', { name: 'Sign In to Get Started' })).toHaveCount(0);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`package-book-${width}.png`),
      fullPage: true,
    });
  }

  await book.click();
  await expect(page).toHaveURL(portal(`/lvp/book/${TAX}?package=${BUNDLE}`));
  const card = page.getByTestId('booking-link');
  await expect(card.getByRole('heading', { name: 'Book Tax consultation' })).toBeVisible();
  await card.getByRole('link', { name: 'Sign In to Book' }).click();
  await expect(page).toHaveURL(portal(`/lvp/sign-in?book=${TAX}&package=${BUNDLE}`));
  const form = page.getByTestId('sign-in-form');
  await form.getByLabel('Email Address').fill('john@example.com');
  await form.getByLabel('Password', { exact: true }).fill('Sample-pass-2026');
  await form.getByRole('button', { name: 'Sign In' }).click();
  // Booking opens on the type; the address drops ?book= and ?package= once it has.
  await expect(page).toHaveURL(portal('/lvp/appointments'));
  await expect(
    page
      .getByRole('dialog', { name: 'Schedule an Appointment' })
      .getByRole('button', { name: /Tax consultation/ }),
  ).toHaveAttribute('aria-pressed', 'true');
});
