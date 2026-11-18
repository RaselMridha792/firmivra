// R60, the Client Portal live check's failed rows: CP-F2-04, CP-F2-15 and CP-F1-14 (a staff preview
// read as the raw code "portal.preview_opened" and counted as the client's Last Activity) and
// CP-F1-15 (an unsaved Client Note was lost on Back with no warning). Mock mode, as an Owner
// ("Mock User"). Jamie Sample has a portal login; their own last action is a document upload.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const PREVIEW = 'Portal preview opened by Mock User (staff)';

test('CP-F2-04, F2-15, F1-14: a staff preview names the member, in words, and is never the client’s Last Activity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  const lastActivity = page.getByTestId('status-strip');
  await expect(lastActivity).toContainText('Document Uploaded');

  await page.getByRole('button', { name: 'Open Client Portal' }).click();
  await expect(page.getByTestId('portal-preview')).toContainText('Hi Jamie,');
  await page.goBack();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}`));

  // Recent Portal Activity (CP-F2-15): the preview, by the member, with the IP for an Owner.
  const card = page.getByTestId('portal-activity');
  const first = card.getByTestId('activity-row').first();
  await expect(first).toContainText(PREVIEW);
  await expect(first).toContainText('198.51.100.90');
  await expect(card).not.toContainText('portal.preview_opened');
  // The status strip (CP-F2-04): still the client's own last action.
  await expect(lastActivity).toContainText('Document Uploaded');
  await expect(lastActivity).not.toContainText(/preview/i);

  // View All Activity, the Activity tab (CP-F1-14): the same words.
  await card.getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/activity`));
  const rows = page.getByTestId('activity-row');
  await expect(rows.first()).toContainText(PREVIEW);
  await expect(page.getByTestId('client-portal-manage')).not.toContainText('portal.preview_opened');
});
