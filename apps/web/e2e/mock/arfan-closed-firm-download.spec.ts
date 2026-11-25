import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const owner = 'http://app.localhost:' + port + '/closed-firm-download';
const ownerApi = '**/api/v1/closed-firm-download';
const token = 'synthetic-download-link-token-for-testing-1234';
const fileId = '0199b6a3-0000-7000-8000-000000000011';
const clientId = '0199b6a3-0000-7000-8000-000000000012';
const folderId = '0199b6a3-0000-7000-8000-000000000013';
const grantId = '0199b6a3-0000-7000-8000-000000000014';
const detail = '/firms/0199b6a3-0000-7000-8000-000000000009';

test('F07 verifies the emailed code and downloads the firm exports at phone width', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(ownerApi + '/request-code', async (route) => {
    expect(route.request().headers()['x-download-link']).toBe(token);
    await route.fulfill({ json: { sent: true } });
  });
  await page.route(ownerApi + '/verify-code', async (route) => {
    const { code } = route.request().postDataJSON() as { code: string };
    if (code !== '234567') {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
      });
      return;
    }
    await route.fulfill({
      json: {
        sessionToken: 'synthetic-session',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
  });
  await page.route(ownerApi + '/clients', (route) =>
    route.fulfill({ json: [{ id: clientId, clientNumber: 1, displayName: 'Sample client' }] }),
  );
  const name = 'Report' + 'a'.repeat(120) + '.pdf';
  await page.route(ownerApi + '/files', (route) =>
    route.fulfill({
      json: [
        {
          id: fileId,
          clientId,
          clientName: 'Sample client',
          fileName: name,
          sizeBytes: 12,
          folder: { id: folderId, name: 'Reports' },
        },
      ],
    }),
  );
  await page.route(ownerApi + '/files/' + fileId + '/link', (route) =>
    route.fulfill({ json: { url: 'http://app.localhost:' + port + '/synthetic-test.pdf' } }),
  );
  await page.route('**/synthetic-test.pdf', (route) =>
    route.fulfill({
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="test.pdf"',
      },
      body: '%PDF-1.4 fake',
    }),
  );
  await page.route(ownerApi + '/clients.csv', async (route) => {
    expect(route.request().headers()['authorization']).toBe('Bearer synthetic-session');
    await route.fulfill({ contentType: 'text/csv', body: 'Name\nSample client' });
  });
  await page.goto(owner + '#token=' + token);
  await page.getByRole('button', { name: 'Send email code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Code sent' })).toBeVisible();
  const code = page.getByLabel('Email code');
  await code.fill('1');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'six-digit' })).toBeVisible();
  await code.fill('111111');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not verify' })).toBeVisible();
  await code.fill('234567');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('heading', { name: 'Sample client' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('owner-download.png'), fullPage: true });
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download clients.csv' }).click();
  expect((await csv).suggestedFilename()).toBe('clients.csv');
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ' + name }).click();
  expect((await file).suggestedFilename()).toBe('test.pdf');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Send email code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download clients.csv' })).toHaveCount(0);
});

test('F08 opens the linked page, issues and revokes access, and retains it on reload', async ({
  page,
}, info) => {
  const base = 'http://admin.localhost:' + port;
  const startsAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const expiresAt = new Date(Date.now() + 70 * 86_400_000).toISOString();
  let grant: { reason: string; revokeReason: string | null; revokedAt: string | null } | null =
    null;
  await page.route('**/api/v1/admin' + detail + '/download-access', (route) => {
    if (route.request().method() === 'POST') {
      const { reason } = route.request().postDataJSON() as { reason: string };
      grant = { reason, revokedAt: null, revokeReason: null };
      return route.fulfill({ json: { id: grantId, expiresAt, emailAccepted: true } });
    }
    return route.fulfill({
      json: grant
        ? [{ ...grant, id: grantId, kind: 'REQUESTED', startsAt, expiresAt, log: [] }]
        : [],
    });
  });
  await page.route(
    '**/api/v1/admin' + detail + '/download-access/' + grantId + '/revoke',
    (route) => {
      const { reason } = route.request().postDataJSON() as { reason: string };
      if (grant) grant = { ...grant, revokedAt: new Date().toISOString(), revokeReason: reason };
      return route.fulfill({ json: { id: grantId, revoked: true } });
    },
  );
  await page.goto(base + detail + '?from=%2Ffirms');
  await page.getByRole('link', { name: 'Manage download access' }).click();
  await expect(page.getByText('No download grants have been issued.')).toBeVisible();
  await page.getByRole('button', { name: 'Grant temporary download access' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Grant temporary download access' }).click();
  await expect(dialog.getByText('Enter a reason of 1 to 1,000 characters.')).toBeVisible();
  await dialog.getByLabel('Reason').fill('  Sample owner request  ');
  await dialog.getByRole('button', { name: 'Grant temporary download access' }).click();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();
  await expect(page.getByText('Issue reason: Sample owner request')).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-download-access.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revoke access' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Sample request withdrawn');
  await dialog.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Revoke reason: Sample request withdrawn')).toBeVisible();
  await page.getByRole('link', { name: 'Back to firm details' }).click();
  await expect(page).toHaveURL(base + detail + '?from=%2Ffirms');
});
