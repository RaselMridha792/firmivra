import { expect, test } from '@playwright/test';

// R60, the firm workspace's Client Portal module, Frame 1 (client-portal.jpg; developer
// instructions 1 to 6 and 10): choose a client from the list, see their header, Portal Summary and
// Recent Activity; Recent Clients and the address keep the choice, and switching shows only the
// new client. Mock mode (the clients mock's synthetic clients). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a client chosen in the list shows their portal summary, and switching keeps only the new one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/client-portal'));
  const list = page.getByTestId('portal-client-list');
  await expect(list.getByTestId('portal-client-row').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Select a client')).toBeVisible();

  await list.getByTestId('portal-client-row').filter({ hasText: 'Jamie Sample' }).click();
  await expect(page).toHaveURL(/client=/);
  const header = page.getByTestId('client-portal-header');
  await expect(header).toContainText('Jamie Sample');
  await expect(header).toContainText(/ID: CL-\d+/);
  const summary = page.getByTestId('portal-summary');
  await expect(summary.getByTestId('summary-documents')).toContainText('2 pending review');
  await expect(summary.getByTestId('summary-invoices')).toContainText('$290.00 outstanding');
  await expect(page.getByTestId('recent-activity')).toContainText('Document Uploaded');

  // A summary card opens its tab for the same client.
  await summary.getByTestId('summary-documents').click();
  await expect(page).toHaveURL(/tab=documents/);
  await expect(page.getByRole('tab', { name: 'Documents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Another client: only theirs shows, and both are now in Recent Clients.
  await list.getByTestId('portal-client-row').filter({ hasText: 'Acme Widgets' }).click();
  await expect(header).toContainText('Acme Widgets LLC (fake)');
  await expect(header).not.toContainText('Jamie Sample');
  await expect(page.getByTestId('recent-activity')).toContainText(
    'No portal activity recorded yet',
  );
  const recent = page.getByTestId('recent-clients');
  await expect(recent).toContainText('Jamie Sample');
  await expect(recent).toContainText('Acme Widgets LLC (fake)');
  // The address keeps the active client through a reload.
  await page.reload();
  await expect(page.getByTestId('client-portal-header')).toContainText('Acme Widgets LLC (fake)', {
    timeout: 60_000,
  });
});
