import { expect, test } from '@playwright/test';

// R56, Business Advisory Review Two A-12, A-13: a client whose service is under way but who has
// no engagement yet (added before Add Client started one) can be sent a document request at once:
// the first request starts the engagement and lists the request; the next one uses it. Mock mode.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
/** Marcus's primary service (IN_PROGRESS), seeded with no engagement. */
const PRIMARY = '0199c0f1-a210-7000-8000-000000000010';
const marcus = `http://app.localhost:${port}/business-advisory/clients/0199c0f1-a200-7000-8000-000000000001`;

test('A-12, A-13: Request Document works for an advisory client with no engagement yet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(`${marcus}/documents`);
  const docs = page.getByTestId('tab-documents');
  const request = docs.getByRole('button', { name: 'Request Document' });
  await expect(request).toBeEnabled({ timeout: 60_000 });
  await expect(docs).not.toContainText('nothing can be filed or requested here yet');

  for (const title of ['Signed engagement letter', 'Prior year balance sheet']) {
    await request.click();
    const dialog = page.getByTestId('request-document');
    await dialog.getByLabel('Document needed').fill(title);
    await page.getByRole('button', { name: 'Send Request' }).click();
    await expect(page.getByText(`Requested: ${title}`)).toBeVisible();
    await expect(page.getByTestId('tab-doc-requests')).toContainText(title);
  }
  // The primary service now offers its engagement, which both requests went to.
  await request.click();
  const service = page.getByTestId('request-document').getByLabel('Service');
  await expect(service.locator(`option[value="workstream:${PRIMARY}"]`)).toHaveCount(0);
  await expect(service.locator('option').first()).not.toHaveAttribute('value', /^workstream:/);
});
