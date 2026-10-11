import { expect, test } from '@playwright/test';
import { createDocumentsMock } from '../../src/mocks/documents';
import { clientFixtures, firstClientId } from '../../src/mocks/clients';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/clients/${firstClientId}/documents`;
test.beforeEach(async ({ page }) => {
  const documents = createDocumentsMock({ role: 'OWNER' });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path.endsWith(`/clients/${firstClientId}`)) json = clientFixtures()[0];
    else if (path.endsWith('/document-categories')) json = { items: await documents.categories() };
    else if (path.endsWith('/document-requests'))
      json = { items: await documents.requests(firstClientId) };
    else if (path.endsWith('/documents')) {
      const cursor = new URL(route.request().url()).searchParams.get('cursor') ?? undefined;
      json = await documents.list(firstClientId, { limit: 1, cursor });
    } else return route.continue();
    await route.fulfill({ json });
  });
});

for (const [status, code, state] of [
  [403, 'FORBIDDEN', 'page-forbidden'],
  [500, 'INTERNAL_ERROR', 'page-error'],
] as const) {
  test(`documents API shows ${state} inside its screen`, async ({ page }) => {
    await page.route('**/clients/*/documents?*', (route) =>
      route.fulfill({
        status,
        json: { error: { code, message: 'Unable to load documents.' } },
      }),
    );
    await page.goto(url);
    await expect(page.getByTestId('page-title')).toBeVisible();
    await expect(
      page.getByTestId('client-documents-screen').getByTestId(state).first(),
    ).toBeVisible();
  });
}

test('document paging and download use the documents API', async ({ page }) => {
  await page.goto(url);
  const list = page.getByTestId('client-documents-table');
  const first = await list.getByTestId('document-name').innerText();
  await page.getByTestId('documents-next').click();
  await expect(list.getByTestId('document-name')).not.toHaveText(first);
  await page.getByTestId('documents-previous').click();
  await expect(list.getByTestId('document-name')).toHaveText(first);
  await page.route('**/business/documents/*/download', (route) =>
    route.fulfill({
      json: {
        url: `http://app.localhost:${port}/synthetic-document`,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    }),
  );
  await page.route('**/synthetic-document', (route) =>
    route.fulfill({ body: 'Synthetic document' }),
  );
  for (let i = 0; i < 10 && (await list.getByTestId('document-download').isDisabled()); i++) {
    await page.getByTestId('documents-next').click();
  }
  const download = page.waitForRequest('**/business/documents/*/download');
  await list.getByTestId('document-download').click();
  await download;
  await expect(page).toHaveURL(/synthetic-document/);
});
