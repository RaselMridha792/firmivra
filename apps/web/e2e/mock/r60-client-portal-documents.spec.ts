import { expect, test } from '@playwright/test';

// R60, the Client Portal module's Documents (Frame 3, documents-tab.jpg; developer instructions 18
// and 19): the five KPIs, the tabs, filters and table from the canonical Documents library, the
// open requests and the recent document activity, on Frame 2 and in Frame 1's Documents tab. Mock
// mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("a client's portal documents: KPIs, tabs, requests and activity", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/documents`));
  const docs = page.getByTestId('portal-documents');
  const kpis = docs.getByTestId('document-kpis');
  await expect(kpis).toContainText('Total Documents', { timeout: 60_000 });
  await expect(kpis).toContainText('12');
  await expect(kpis).toContainText('Client Uploaded');
  await expect(docs.getByRole('tab', { name: 'All Documents (12)' })).toBeVisible();
  await expect(docs.getByRole('button', { name: 'Upload Document' })).toBeVisible();
  await expect(page.getByTestId('document-requests-panel')).toContainText('Document Requests');
  await expect(page.getByTestId('recent-document-activity')).toContainText('Document uploaded');

  // The Requested tab lists the requests instead of files.
  await docs.getByRole('tab', { name: /Requested/ }).click();
  await expect(docs.getByRole('tab', { name: /Requested/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Upload opens Documents with the client chosen.
  await docs.getByRole('button', { name: 'Upload Document' }).click();
  await expect(page).toHaveURL(app(`/documents/upload?clientId=${JAMIE}`));

  // Frame 1's Documents tab is the same view.
  await page.goto(app(`/client-portal?client=${JAMIE}&tab=documents`));
  await expect(page.getByTestId('portal-documents').getByTestId('document-kpis')).toContainText(
    'Total Documents',
    { timeout: 60_000 },
  );
});
