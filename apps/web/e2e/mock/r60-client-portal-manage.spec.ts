import { expect, test } from '@playwright/test';

// R60, the Client Portal module's individual client page (Frame 2,
// individual-client-portal-management-access-and-visibility.jpg; developer instructions 13 to 17):
// the header and status strip, Pending Client Actions, Portal Content & Visibility, Quick Actions
// (lock and unlock), the portal link, the tabs, and Access & Security's login history. Mock mode
// (the clients mock's synthetic clients). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("one client's portal management: status, pending actions, visibility and lock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  await expect(page.getByTestId('manage-header')).toContainText('Active Portal');
  const strip = page.getByTestId('status-strip');
  await expect(strip).toContainText('Portal Since');
  await expect(strip).toContainText('Enabled');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Portal Management',
  );

  const pending = page.getByTestId('pending-actions');
  await expect(pending).toContainText('2 Documents Requested');
  await expect(pending).toContainText('$290.00 Outstanding');

  // Hide Messages for this client: Hidden, and on again.
  const visibility = page.getByTestId('portal-visibility');
  const messages = visibility.getByRole('switch', { name: 'Messages visible to this client' });
  await messages.click();
  await expect(messages).toHaveAttribute('aria-checked', 'false');
  await messages.click();
  await expect(messages).toHaveAttribute('aria-checked', 'true');

  // Lock with a reason, then unlock.
  await page.getByTestId('action-lock').click();
  await page.getByLabel('Reason (staff only, optional)').fill('Fake: asked by phone');
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('manage-header')).toContainText('Locked');
  await page.getByTestId('action-unlock').click();
  await expect(page.getByTestId('manage-header')).toContainText('Active Portal');

  await expect(page.getByTestId('portal-link')).toContainText('portal.localhost');
  await expect(page.getByTestId('portal-activity')).toContainText('Document Uploaded');

  // Access & Security keeps the client and lists the login history.
  await page.getByRole('link', { name: 'Access & Security' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/access`));
  await expect(page.getByTestId('login-history')).toContainText('Successful login');
  await expect(page.getByTestId('login-history')).toContainText('Wrong password');
  await expect(page.getByTestId('mfa-card')).toContainText('authenticator app is set up');

  // Activity filters by type.
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await page.getByLabel('Event type').selectOption('document');
  await expect(page.getByTestId('activity-tab')).toContainText('Document Uploaded');
  await expect(page.getByTestId('activity-tab')).not.toContainText('Message from Client');

  // Back to All Clients returns to the list.
  await page.getByRole('button', { name: 'Back to All Clients' }).click();
  await expect(page).toHaveURL(new RegExp(`${app('/client-portal')}$`));
});
