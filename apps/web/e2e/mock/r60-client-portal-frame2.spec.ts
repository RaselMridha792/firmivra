// R60, the Client Portal module's Frame 2 (instructions 13 to 16): Client Notes, Copy Link, the
// breadcrumb's Clients link, the Portal Content tab, the invitation's status and date, and
// Resend Portal Invitation. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
/** Acme Widgets LLC (fake): an email, no portal login. */
const ACME = '0199b6a1-0000-7000-8000-000000000002';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test("Frame 2: Client Notes, Copy Link, the breadcrumb's Clients link and the Portal Content tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  await expect(page.getByText('Client Notes (Internal Only)')).toBeVisible();

  const link = page.getByTestId('portal-link');
  await link.getByRole('button', { name: 'Copy Link' }).click();
  await expect(link.getByRole('button', { name: 'Copied' })).toBeVisible();

  await page
    .getByTestId('client-portal-manage')
    .getByRole('link', { name: 'Portal Content' })
    .click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/content`));
  await expect(page.getByRole('switch').first()).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Clients' })
    .click();
  await expect(page).toHaveURL(app('/client-portal'));
});

test("Frame 2: the invitation's status and date, and Send then Resend Portal Invitation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  // Jamie has signed in: accepted, nothing to send.
  await page.goto(app(`/client-portal/${JAMIE}/access`));
  const invitation = page.getByTestId('invitation-card');
  await expect(invitation).toContainText('Accepted / Activated', { timeout: 60_000 });
  await expect(page.getByTestId('action-invite')).toHaveCount(0);

  // Acme has an email and no login: not sent yet, then sent from Quick Actions.
  await page.goto(app(`/client-portal/${ACME}/access`));
  await expect(invitation).toContainText('Not sent', { timeout: 60_000 });
  const manage = page.getByTestId('client-portal-manage');
  await manage.getByRole('link', { name: 'Overview' }).click();
  const invite = page.getByTestId('action-invite');
  await expect(invite).toHaveText('Send Portal Invitation');
  await invite.click();
  await expect(page.getByText('Portal invitation sent.')).toBeVisible();
  // Sent: the button resends it, and Access & Security has its status and date.
  await expect(invite).toHaveText('Resend Portal Invitation');
  await manage.getByRole('link', { name: 'Access & Security' }).click();
  await expect(invitation).not.toContainText('Not sent');
  await expect(invitation).toContainText(/by Morgan Example/);
});
