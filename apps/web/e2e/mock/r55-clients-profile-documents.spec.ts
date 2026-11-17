import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (N8-37): a client's Documents tab. Mock mode as the Owner (mocks/documents.ts:
// Jamie Sample's twelve files and open requests), at her 1165 x 747 window. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

// Clients Review 2 (N8-37): she found Request a document under the ten-file table and its pages,
// reached only by scrolling. It sits at the top of the tab: in the first screenful, before the
// documents list on screen and in reading order, and it still opens the request form.
test('N8-37: Request a document is at the top of the profile Documents tab, before the files', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/clients/0199b6a1-0000-7000-8000-000000000001/documents'));
  const request = page.getByRole('button', { name: 'Request a document', exact: true });
  const files = page.getByTestId('client-documents-list');
  await expect(request).toBeVisible({ timeout: 60_000 });
  await expect(files.getByTestId('document-name').filter({ visible: true }).first()).toBeVisible();

  // On screen without scrolling.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const button = await request.boundingBox();
  expect(button).not.toBeNull();
  expect(button!.y + button!.height).toBeLessThanOrEqual(747);
  // Above the documents list, and before it in reading order.
  const list = await files.boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(list!.y);
  const before = await request.evaluate(
    (el, listEl) => {
      if (!listEl) return false;
      return Boolean(el.compareDocumentPosition(listEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    await files.elementHandle(),
  );
  expect(before).toBe(true);

  // The same request flow as before.
  await request.click();
  const form = page.getByRole('dialog', { name: 'Request a document' });
  await expect(form).toBeVisible();
  await expect(form.getByTestId('request-document-form')).toBeVisible();
});
