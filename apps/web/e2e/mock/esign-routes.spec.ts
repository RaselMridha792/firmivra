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
  [app('/firm-sign/bulk'), 'Bulk send'],
  [app('/firm-sign/reports'), 'Signing reports'],
  [app('/firm-sign/settings'), 'Signing settings'],
  [app('/firm-sign/in-person/req-1'), 'In-person signing'],
  [app('/clients/client-1/signatures'), 'Client signatures'],
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

test('signer and kiosk pages are not indexed, and the kiosk has no menu', async ({ page }) => {
  await page.goto(portal('/lvp/sign'));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByTestId('signing-firm')).not.toBeEmpty();
  await page.goto(app('/firm-sign/in-person/req-1'));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByTestId('page-title')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
