import { expect, type Page, test } from '@playwright/test';

// Appointments Review 2, row 3 (booking links), in mock mode (playwright.mock.config.ts). The
// firm copies each type's own booking link or its website button; the portal's /{firm}/book/{id}
// opens booking on that exact type, refuses an archived type, one clients can't book online and a
// link to none, and keeps the type through sign-in and sign-up. The mock types
// (mocks/appointments.ts): 1 Tax consultation and 2 Bookkeeping review take bookings, 3 Internal
// planning is not bookable by clients, 4 Old intake call is archived.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const typeId = (n: number) => `0199b6c2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TAX = typeId(1);
const INTERNAL = typeId(3);
const ARCHIVED = typeId(4);

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

test('every type has Copy Booking Link and Copy Embed Code; each targets that exact type', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/calendar/types'));
  const list = page.getByTestId('types-list');
  await expect(list.getByRole('button', { name: 'Tax consultation', exact: true })).toBeVisible();
  const menuOf = (name: string) =>
    list.getByRole('button', { name: `Actions for ${name}` }).click();

  for (const name of [
    'Tax consultation',
    'Bookkeeping review',
    'Internal planning',
    'Old intake call',
  ]) {
    await menuOf(name);
    await expect(page.getByRole('menuitem', { name: 'Copy Booking Link' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy Embed Code' })).toBeVisible();
    await page.keyboard.press('Escape');
  }

  await menuOf('Tax consultation');
  await page.screenshot({ path: testInfo.outputPath('type-menu.png') });
  await page.getByRole('menuitem', { name: 'Copy Booking Link' }).click();
  await expect(page.getByTestId('types-result')).toContainText(
    'Booking link for Tax consultation copied.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    new RegExp(`^https?://[^/]+/lvp/book/${TAX}$`),
  );

  // An archived type's link is still copied (it stays the same), with what the client will see.
  await menuOf('Old intake call');
  await page.getByRole('menuitem', { name: 'Copy Booking Link' }).click();
  await expect(page.getByTestId('types-result')).toContainText(
    'This appointment type is archived. The link stays the same, but it takes no new bookings',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    new RegExp(`/lvp/book/${ARCHIVED}$`),
  );

  // Copy Embed Code: a button that opens that type's page, and why it is not an iframe.
  await menuOf('Bookkeeping review');
  await page.getByRole('menuitem', { name: 'Copy Embed Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Embed Code for Bookkeeping review' });
  await expect(dialog.getByTestId('embed-why-button')).toContainText(
    'Why a button and not an embedded page',
  );
  const code = dialog.getByRole('textbox', { name: /embed/i });
  await expect(code).toHaveValue(
    new RegExp(`^<a href="https?://[^"]+/lvp/book/${typeId(2)}" target="_blank" rel="noopener"`),
  );
  await expect(code).toHaveValue(/>Book Bookkeeping review<\/a>$/);
  await expect(code).not.toHaveValue(/iframe/);
  await page.screenshot({ path: testInfo.outputPath('embed-dialog.png') });
  await dialog.getByRole('button', { name: 'Copy Embed Code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `/lvp/book/${typeId(2)}"`,
  );
  await page.keyboard.press('Escape');

  // The type's settings show its booking link too, and say when it takes no bookings.
  await list.getByRole('button', { name: 'Internal planning', exact: true }).click();
  const settingsLink = page.getByTestId('type-booking-link');
  await expect(settingsLink.getByRole('textbox').first()).toHaveValue(
    new RegExp(`/lvp/book/${INTERNAL}$`),
  );
  await expect(settingsLink.getByTestId('public-link-notice')).toContainText('hidden from clients');
});

test('a signed-in client opens the link and lands on booking for that exact type', async ({
  page,
}, testInfo) => {
  await page.goto(portal(`/lvp/book/${TAX}`));
  await expect(page).toHaveURL(portal('/lvp/appointments'));
  const dialog = page.getByRole('dialog', { name: 'Schedule an Appointment' });
  await expect(dialog.getByRole('button', { name: /Tax consultation/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('button', { name: /Bookkeeping review/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(dialog.getByTestId('booking-link-refused')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('booking-opened.png') });
});

test('an archived type, one clients cannot book online, and no type are refused plainly', async ({
  page,
}, testInfo) => {
  for (const [id, title] of [
    [ARCHIVED, 'Old intake call Is No Longer Offered'],
    [INTERNAL, "Internal planning Can't Be Booked Online"],
    ['0199b6c2-0000-7000-8000-000000000999', 'This Booking Link Does Not Work'],
    ['not-a-type', 'This Booking Link Does Not Work'],
  ] as const) {
    await page.goto(portal(`/lvp/book/${id}`));
    const refused = page.getByTestId('booking-link-refused');
    await expect(refused.getByRole('heading', { name: title })).toBeVisible();
    await expect(page).toHaveURL(portal(`/lvp/book/${id}`));
    await expect(page.getByRole('link', { name: 'Sign In to Book' })).toHaveCount(0);
  }
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
  await page.goto(portal(`/lvp/book/${ARCHIVED}`));
  await expect(page.getByTestId('booking-link-refused')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('refused-archived-375.png'), fullPage: true });
});

test('signed out: the type survives sign-in, and booking opens on it', async ({
  page,
}, testInfo) => {
  await signOut(page);
  await moveTo(page, `/lvp/book/${TAX}`);
  const card = page.getByTestId('booking-link');
  await expect(card.getByRole('heading', { name: 'Book Tax consultation' })).toBeVisible();
  await expect(card.getByTestId('booking-link-type')).toHaveText('Tax consultation');
  await expect(card.getByTestId('booking-link-sign-up')).toContainText(
    'after the firm approves your account you can book this time',
  );
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`signed-out-${width}.png`), fullPage: true });
  }

  await card.getByRole('link', { name: 'Sign In to Book' }).click();
  await expect(page).toHaveURL(portal(`/lvp/sign-in?book=${TAX}`));
  const form = page.getByTestId('sign-in-form');
  await form.getByLabel('Email Address').fill('john@example.com');
  await form.getByLabel('Password', { exact: true }).fill('Sample-pass-2026');
  await form.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(portal('/lvp/appointments'));
  await expect(
    page
      .getByRole('dialog', { name: 'Schedule an Appointment' })
      .getByRole('button', { name: /Tax consultation/ }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('signed out: a new account is told it can book once the firm approves it', async ({
  page,
}) => {
  await signOut(page);
  await moveTo(page, `/lvp/book/${TAX}`);
  await page.getByTestId('booking-link').getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up'));
  const form = page.getByTestId('sign-up-form');
  await form.getByLabel('Full Name *').fill('Jamie Example');
  await form.getByLabel('Email Address *').fill('jamie.booking@example.test');
  await form.getByLabel('Phone Number *').fill('4045550123');
  await form.getByLabel('Create a Password *').fill('Sample-pass-2026');
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2026');
  await form.getByRole('radio', { name: /Auburn Office/ }).check();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'));
  await page.getByRole('textbox', { name: 'Verification code, digit 1' }).fill('000000');
  await page.getByRole('button', { name: 'Verify Email' }).click();
  if (process.env['NEXT_PUBLIC_API_MOCK_SIGNUP_PHONE'] === 'required') {
    await expect(page).toHaveURL(portal('/lvp/sign-up/verify-phone'));
    await page.getByRole('textbox', { name: 'Verification code, digit 1' }).fill('000000');
    await page.getByRole('button', { name: 'Verify Phone Number' }).click();
  }
  await expect(page).toHaveURL(portal('/lvp/sign-up/done'));
  await expect(page.getByTestId('booking-after-approval')).toContainText(
    'After the firm approves your account you can book this time.',
  );
});
