import { expect, test, type Page } from '@playwright/test';

// R56: Firmivra's own Privacy Policy and Terms of Service, public on the firm workspace host,
// with the text of docs/specs/Firmivra_Privacy_Policy.docx and Firmivra_Terms_of_Service.docx.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const firm = (path: string) => `http://app.localhost:${port}${path}`;

/** No drafting text reaches the public page: no placeholders, bracketed fields or notes. */
async function expectNoDraftText(page: Page) {
  const text = await page.locator('main').innerText();
  for (const draft of ['PLACEHOLDER', '[', 'COMPLETE BEFORE', 'PUBLICATION NOTE', 'COUNSEL']) {
    expect(text, draft).not.toContain(draft);
  }
}

test('the Privacy Policy is public, whole and free of drafting text', async ({ page }) => {
  await page.goto(firm('/privacy'));
  await expect(page).toHaveTitle(/Privacy Policy/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByText('October 2, 2026').first()).toBeVisible();

  // Sections 1 to 23 and Appendix A; the drafting appendices B and C stay out.
  const article = page.locator('main section[id]');
  await expect(article).toHaveCount(24);
  await expect(
    page.getByRole('heading', { name: '23. Contact Us and Privacy Requests' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Appendix B/ })).toHaveCount(0);

  // Contact details come from lib/company.ts; the legal name is still pending, so it is left out.
  const contact = page.locator('#contact-us-and-privacy-requests');
  await expect(contact.getByRole('link', { name: 'admin@firmivra.com' }).first()).toHaveAttribute(
    'href',
    'mailto:admin@firmivra.com',
  );
  await expect(contact).toContainText('1393 Duncan Lane, Unit 100, Auburn, GA 30011, USA');
  await expect(contact).not.toContainText('Legal entity name');

  // Only the named provider is listed.
  const providers = page.getByRole('table', {
    name: 'Appendix A - Subprocessor / Service Provider List (Launch Version)',
  });
  await expect(providers.getByRole('row')).toHaveCount(2);
  await expect(providers).toContainText('Amazon Web Services (AWS)');
  await expectNoDraftText(page);

  await page
    .getByRole('navigation', { name: 'Contents' })
    .getByRole('link', {
      name: '12. Cookies and Similar Technologies',
    })
    .click();
  await expect(page).toHaveURL(/#cookies-and-similar-technologies$/);

  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', {
      name: 'Terms of Service',
    })
    .click();
  await expect(page).toHaveURL(firm('/terms'));
});

test('the Terms of Service are public, whole and free of drafting text', async ({ page }) => {
  await page.goto(firm('/terms'));
  await expect(page).toHaveTitle(/Terms of Service/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms of Service' }),
  ).toHaveAttribute('aria-current', 'page');

  // Sections 1 to 42 and Appendix A; the optional arbitration section waits for counsel.
  await expect(page.locator('main section[id]')).toHaveCount(43);
  await expect(page.getByRole('heading', { name: /Arbitration/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '41. Miscellaneous' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '42. Contact' })).toBeVisible();

  const venue = page.locator('#governing-law-and-venue');
  await expect(venue).toContainText('Governing law');
  await expect(venue).toContainText('Georgia, USA');
  // The county is still pending, so the venue line is left out.
  await expect(venue).not.toContainText('Exclusive courts/venue');

  const contact = page.locator('#contact');
  await expect(contact).toContainText('Legal email');
  await expect(contact).toContainText('(770) 238-9815');
  await expectNoDraftText(page);
});

test('the business application links its consent to both pages', async ({ page }) => {
  await page.goto(firm('/apply'));
  await expect(page.getByTestId('application-form')).toBeVisible();
  for (const [name, href] of [
    ['Terms of Service', '/terms'],
    ['Privacy Policy', '/privacy'],
  ] as const) {
    const link = page.getByRole('link', { name: `${name} (opens in a new tab)` });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
  }
});

test('the legal pages fit a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/privacy', '/terms']) {
    await page.goto(firm(path));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
