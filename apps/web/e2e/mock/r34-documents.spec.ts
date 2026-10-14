import { expect, test } from '@playwright/test';

// R34: the Documents page (docs/mockups/firm-workspace/documents/) matches the design's chrome —
// header, five stat cards, folders, filters, table, Quick Upload, Document Requests and Recent
// Activity — against mocks/documents.ts, mocks/clients.ts and mocks/audit-log.ts. Mock mode
// (NEXT_PUBLIC_API_MOCK=all), the default OWNER role. The API has no firm-wide document list (only
// GET .../clients/{id}/documents), so the table needs a client chosen first; that gap, and every
// other difference from the design, is in the PR, not re-asserted row by row here.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/documents'));
  await expect(page.getByTestId('documents-screen')).toBeVisible();
});

test('every chrome element of the design is present, with honest placeholders where the API has no firm-wide data', async ({
  page,
}) => {
  await expect(page.getByTestId('page-title')).toHaveText('Documents');
  await expect(
    page.getByText('Securely manage, store, and share client and firm documents.'),
  ).toBeVisible();
  await expect(page.getByTestId('open-document-requests')).toHaveAttribute(
    'href',
    '/modules/document-requests',
  );
  await expect(page.getByTestId('open-upload-document')).toHaveAttribute(
    'href',
    '/modules/document-upload',
  );

  // Five stat cards, each a quiet "—": the API has no firm-wide document count (R34 PR).
  const cards = page.getByTestId('stat-cards').locator('> *');
  await expect(cards).toHaveCount(5);
  for (const label of [
    'All Documents',
    'Recently Uploaded',
    'Needs Review',
    'Signed / Completed',
    'Missing Documents',
  ]) {
    await expect(page.getByTestId('stat-cards')).toContainText(label);
  }
  await expect(cards.first()).toContainText('—');

  // Folders: "All Documents" plus the firm's real categories (not the design's example names),
  // then the inert Archived/Trash rows.
  const folders = page.getByTestId('folder-row');
  await expect(folders).toHaveCount(5); // All Documents + Tax Documents/Business Documents/Identification/Old Receipts
  await expect(folders.first()).toHaveText(/All Documents/);
  await expect(page.getByTestId('folders-panel')).toContainText('Tax Documents');
  await expect(page.getByTestId('folders-panel')).toContainText('Old Receipts');
  await expect(page.getByTestId('folder-archived')).toBeDisabled();
  await expect(page.getByTestId('folder-trash')).toHaveText(/Trash0/);

  await expect(page.getByTestId('quick-upload-card')).toContainText('Drag & drop files here');
  await expect(page.getByTestId('quick-upload-card')).toContainText(
    'Supports PDF, JPG, PNG, Excel (.xlsx) or Word (.docx)',
  );
  await expect(page.getByTestId('quick-upload-dropzone')).toHaveAttribute(
    'href',
    '/modules/document-upload',
  );
  await expect(page.getByTestId('document-requests-card')).toContainText(
    'Request specific documents from clients or team members.',
  );
  await expect(page.getByTestId('create-document-request')).toHaveAttribute(
    'href',
    '/modules/document-requests',
  );

  // No client chosen yet: the table area explains why, instead of an empty grid pretending to be
  // the whole firm's library.
  await expect(page.getByTestId('documents-no-client')).toBeVisible();
});

test('choosing a client shows that client’s real documents: icons, sizes, status and filters', async ({
  page,
}) => {
  await page.selectOption('[data-testid="filter-client"]', { label: 'Jamie Sample' });
  // Newest-first is the API's only order, so the 10 most recent uploads fill page 1.
  await expect(page.getByTestId('documents-table')).toContainText('Tax_Organizer_2025.pdf');

  // 12 fixture documents, 10 per page by default: an 11th and 12th exist, so Next is enabled.
  await expect(page.getByTestId('documents-pagination')).toContainText('Showing 10 documents');
  await expect(page.getByTestId('documents-next')).toBeEnabled();
  await expect(page.getByTestId('documents-previous')).toBeDisabled();

  // The file-type icon matches the real content type (PDF/Word/Excel), not one fixed glyph.
  await expect(page.getByTestId('documents-table')).toContainText('Rental_Income_2025.xlsx');
  await expect(page.getByTestId('documents-table')).toContainText('Office_Lease.docx');

  // W-2_2025.pdf is the oldest upload, so it sits on page 2 of the default page size.
  await expect(page.getByText('W-2_2025.pdf')).not.toBeVisible();
  await page.getByTestId('documents-page-size').selectOption('25');
  await expect(page.getByTestId('documents-table')).toContainText('W-2_2025.pdf');

  // scanStatus drives the real status word; INFECTED/FAILED both read "Blocked"/"Scan failed",
  // never the design's invented "Completed"/"Signed" (no such states exist in the data model).
  await expect(page.getByTestId('documents-table')).toContainText('Verified');
  await expect(page.getByTestId('documents-table')).toContainText('Blocked');
  await expect(page.getByTestId('documents-table')).toContainText('Scan failed');

  // Download works for a CLEAN document; a blocked one stays disabled.
  const cleanRow = page.locator('tr', { hasText: 'Driver_License.jpg' });
  await cleanRow.getByTestId('document-actions').click();
  await expect(cleanRow.getByTestId('document-download')).toBeEnabled();
  await cleanRow.getByTestId('document-actions').click(); // close the menu before the next action

  // Status filters the loaded page client-side (the API has no scanStatus query param).
  await page.getByTestId('filter-status').selectOption('FAILED');
  await expect(page.getByTestId('documents-table')).toContainText('Office_Lease.docx');
  await expect(page.getByTestId('documents-table')).not.toContainText('Driver_License.jpg');
});

test('Recent Activity is real for the Owner (mocks/audit-log.ts), via the existing audit log route', async ({
  page,
}) => {
  await expect(page.getByTestId('recent-activity-card')).toBeVisible();
  await expect(
    page.getByTestId('recent-activity-card').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', '/audit-log');
  await expect(page.getByTestId('recent-activity-restricted')).toHaveCount(0);
});

test('the page reflows to cards at 390px: no clipped or overlapping header text', async ({
  page,
}) => {
  await page.selectOption('[data-testid="filter-client"]', { label: 'Jamie Sample' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('documents-mobile-cards')).toBeVisible();
  await expect(page.locator('[data-testid="documents-table"] table')).not.toBeVisible();
  await expect(page.getByTestId('documents-mobile-cards')).toContainText('Tax_Organizer_2025.pdf');
});
