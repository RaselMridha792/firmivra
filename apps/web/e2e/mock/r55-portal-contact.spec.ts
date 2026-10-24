import { expect, test } from '@playwright/test';

// R55, Client Portal guide 4 and 9.4 (Rasel, Oct 24: the parts without schema): the portal's
// contact details come from Company Profile and Locations, never fixed text. In mock mode
// (playwright.mock.config.ts), whose portal info carries synthetic contact details.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const shots = 'e2e/mock/r55-screenshots/portal';

test('the public footer shows the firm’s address, phone, email and office hours', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp'));
  const footer = page.locator('footer');
  await expect(footer).toContainText('123 Main Street, Suite 100');
  await expect(footer).toContainText('Auburn, GA 30011');
  await expect(footer.getByRole('link', { name: '(770) 555-0134' })).toHaveAttribute(
    'href',
    'tel:7705550134',
  );
  await expect(footer.getByRole('link', { name: 'hello@lvp.example.test' })).toHaveAttribute(
    'href',
    'mailto:hello@lvp.example.test',
  );
  await expect(footer.getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute(
    'href',
    'mailto:hello@lvp.example.test',
  );
  const hours = footer.locator('section', { hasText: 'Office Hours' });
  await expect(hours).toContainText('Monday - Friday');
  await expect(hours).toContainText('9:00 AM - 6:00 PM');
  await expect(hours).toContainText('Saturday - Sunday');
  await expect(hours).toContainText('Closed');
  // None of the text that used to be typed into the page.
  await expect(footer).not.toContainText('Duncan Lane');
  await expect(footer).not.toContainText('By Appointment Only');
  await footer.screenshot({ path: `${shots}/public-footer.png` });
});

test('the signed-in Need Help? card offers the firm’s phone and email', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/documents'));
  const side = page.getByRole('complementary', { name: 'Help and shortcuts' });
  const contact = side.getByTestId('firm-contact');
  await expect(contact.getByRole('link', { name: '(770) 555-0134' })).toHaveAttribute(
    'href',
    'tel:7705550134',
  );
  await expect(contact.getByRole('link', { name: 'hello@lvp.example.test' })).toHaveAttribute(
    'href',
    'mailto:hello@lvp.example.test',
  );
  await expect(side.getByRole('link', { name: 'Send a Message' })).toBeVisible();
  await side.screenshot({ path: `${shots}/need-help-card.png` });

  // The same lines on Appointments and My Services.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Appointments' })
    .click();
  await expect(page.getByTestId('firm-contact')).toContainText('(770) 555-0134');
});
