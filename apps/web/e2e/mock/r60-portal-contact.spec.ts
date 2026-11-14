import { expect, test } from '@playwright/test';

// R60, PRT-3 (Client Portal guide 4, 7.1 and 9.4; client-portal-contact-settings-dashboard.jpg):
// Settings > Client portal > Contact Information switches the corporate office, the client's
// local office and the contact methods, with a Live Preview; the portal's Need Help card shows
// only what is switched on. Mock mode as the Owner and the mock client (office: Lawrenceville).
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-portal-contact';
const KEY = 'firmivra-mock:portal-contact';

test.describe.configure({ timeout: 180_000 });

test('Contact Information switches offices and methods, with a Live Preview', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(app('/settings/portal'));
  const card = page.getByTestId('portal-contact');
  const preview = card.getByTestId('contact-preview');
  await expect(card).toContainText('Office Information to Display', { timeout: 60_000 });
  // The details come from Company Profile and Locations, edited there.
  await expect(card.getByRole('link', { name: 'Edit in Company Profile' })).toHaveAttribute(
    'href',
    '/settings/profile',
  );
  await expect(card.getByRole('link', { name: 'Manage Office Locations' })).toHaveAttribute(
    'href',
    '/settings/locations',
  );
  await expect(preview.getByTestId('firm-contact')).toContainText('(770) 555-0134');
  await expect(preview.getByTestId('local-contact')).toContainText('auburn@example.test');
  await expect(preview).not.toContainText('Book Appointment');

  // The preview follows each switch before it is saved.
  await card.getByLabel('Office for the preview').selectOption({ label: 'Lawrenceville Office' });
  await expect(preview).toContainText('Lawrenceville Office');
  await card.getByRole('switch', { name: 'Allow Text Messages' }).click();
  await card.getByRole('switch', { name: 'Allow Appointments' }).click();
  await card.getByRole('switch', { name: 'Allow Email' }).click();
  await expect(preview.getByTestId('local-contact')).toContainText('Text (555) 987-6543');
  await expect(preview).not.toContainText('lawrenceville@example.test');
  await expect(preview).toContainText('Book Appointment');
  await page.mouse.move(5, 5);
  await card.screenshot({ path: `${shots}/settings.png` });

  // Discard goes back; Save keeps.
  await card.getByRole('button', { name: 'Discard changes' }).click();
  await expect(card.getByRole('switch', { name: 'Allow Email' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await card.getByRole('switch', { name: "Show the client's local office" }).click();
  await expect(preview.getByTestId('local-contact')).toHaveCount(0);
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Contact information saved.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('the portal’s Need Help card shows only what the firm switched on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/documents'));
  const side = page.getByRole('complementary', { name: 'Help and shortcuts' });
  // The defaults: the corporate office and the client's own office, Send a Message, no booking.
  await expect(
    side.getByTestId('firm-contact').getByRole('link', { name: '(770) 555-0134' }),
  ).toHaveAttribute('href', 'tel:7705550134', { timeout: 60_000 });
  await expect(side.getByTestId('local-contact')).toContainText('(555) 987-6543');
  await expect(side).toContainText('Lawrenceville Office');
  await expect(side.getByRole('link', { name: 'Send a Message' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Book Appointment' })).toHaveCount(0);
  await page.mouse.move(5, 5);
  await side.screenshot({ path: `${shots}/portal-default.png` });

  // The firm turns calls and the local office off, and booking on.
  await page.evaluate(
    ([key]) =>
      sessionStorage.setItem(
        key ?? '',
        JSON.stringify({
          showCorporateOffice: true,
          showLocalOffice: false,
          allowPhone: false,
          allowSms: false,
          allowEmail: true,
          allowSecureMessage: true,
          allowAppointmentLink: true,
        }),
      ),
    [KEY],
  );
  await page.reload();
  await expect(side.getByTestId('firm-contact')).toContainText('hello@lvp.example.test', {
    timeout: 60_000,
  });
  await expect(side.getByRole('link', { name: '(770) 555-0134' })).toHaveCount(0);
  await expect(side.getByTestId('local-contact')).toHaveCount(0);
  await expect(side.getByRole('link', { name: 'Book Appointment' })).toHaveAttribute(
    'href',
    '/lvp/appointments',
  );
  await side.screenshot({ path: `${shots}/portal-switched.png` });

  // Secure messages off: no Send a Message anywhere on the page's help.
  await page.evaluate(
    ([key]) => {
      const s = JSON.parse(sessionStorage.getItem(key ?? '') ?? '{}');
      sessionStorage.setItem(key ?? '', JSON.stringify({ ...s, allowSecureMessage: false }));
    },
    [KEY],
  );
  await page.reload();
  await expect(side.getByTestId('firm-contact')).toBeVisible({ timeout: 60_000 });
  await expect(side.getByRole('link', { name: 'Send a Message' })).toHaveCount(0);
});
