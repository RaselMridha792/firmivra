import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

// Every Firm Sign page exists at its public path with its tab title (R13-web placeholders).
const pages: [url: string, title: string][] = [
  [app('/firm-sign'), 'Firm Sign'],
  [app('/firm-sign/new'), 'New signature request'],
  [app('/firm-sign/requests'), 'Signature requests'],
  [app('/firm-sign/requests/req-1'), 'Signature request'],
  [app('/firm-sign/requests/req-1/prepare'), 'Prepare request'],
  [app('/firm-sign/templates'), 'Signing templates'],
  [app('/firm-sign/templates/tpl-1'), 'Signing template'],
  [app('/firm-sign/bulk'), 'Bulk send'],
  [app('/firm-sign/reports'), 'Signing reports'],
  [app('/firm-sign/settings'), 'Signing settings'],
  [app('/firm-sign/in-person/req-1'), 'In-person signing'],
  [portal('/lvp/signatures'), 'Signatures'],
  [portal('/lvp/sign'), 'Sign documents'],
];

for (const [url, title] of pages) {
  test(`${title} at ${new URL(url).pathname}`, async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle(title);
    await expect(page.getByTestId('page-title')).toHaveText(title);
  });
}

test('Client signatures at /clients/{id}/signatures', async ({ page }) => {
  // The client record's layout owns the page's h1; the tab has its own h2.
  await page.goto(app('/clients/0199b6a1-0000-7000-8000-000000000001/signatures'));
  await expect(page).toHaveTitle('Client signatures');
  await expect(page.getByRole('heading', { level: 2, name: 'Signatures' })).toBeVisible();
});

test('signer and kiosk pages are not indexed, and the kiosk has no menu', async ({ page }) => {
  await page.goto(portal('/lvp/sign'));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByTestId('signing-firm')).not.toBeEmpty();
  await page.goto(app('/firm-sign/in-person/req-1'));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByTestId('page-title')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
