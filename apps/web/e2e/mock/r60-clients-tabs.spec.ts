import { expect, test } from '@playwright/test';

// R60, Clients E4 (Octavia's Oct 25 review): the client profile's sections. Services, Intake Forms,
// Tasks and Notes join Overview, Documents, Messages, Invoices, Signatures and Activity; the
// service tabs (here Tax Returns and Tax Planning) come by enrollment and open their module with
// Back to the client; what doesn't fit goes under More. Overview gains Active Services and Recent
// Activity. Mock mode as the Owner; client 1 is Jamie Sample. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-clients-tabs';

test.describe.configure({ timeout: 180_000 });

test('the tabs, Active Services and Recent Activity on Overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A message sent with Add to Client Timeline gives Recent Activity an entry (the mock keeps it
  // until a full reload, so the profile is opened in the app).
  await page.goto(app(`/messages/new?clientId=${jamie}`));
  const box = page.getByRole('checkbox', { name: 'Add to Client Timeline' });
  await expect(box).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel('Subject (optional)').fill('Organizer reminder (sample)');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic text.');
  await box.check();
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  await page
    .getByTestId('compose-outcome')
    .getByRole('link', { name: 'Open conversation' })
    .click();
  await page
    .getByTestId('contact-panel')
    .getByRole('button', { name: 'Thread actions for Jamie Sample' })
    .click();
  await page.getByRole('menuitem', { name: 'View Profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${jamie}`), { timeout: 60_000 });
  const tabs = page.getByRole('navigation', { name: 'Client' });
  await expect(tabs.getByTestId('service-tab')).toHaveCount(2, { timeout: 60_000 });
  const names = await tabs.locator('a').allTextContents();
  expect(names).toEqual([
    'Overview',
    'Services',
    'Documents',
    'Intake Forms',
    'Tax Returns',
    'Tax Planning',
    'Invoices',
    'Messages',
    'Tasks',
    'Notes',
    'Activity',
  ]);
  // The service tabs open their module with Back to this client.
  await expect(tabs.getByRole('link', { name: 'Tax Returns' })).toHaveAttribute(
    'href',
    /^\/tax-returns\?from=/,
  );

  // Active Services: enrolled services only (the finished Bookkeeping is on the Services tab).
  const active = page.getByTestId('active-services');
  await expect(active).toContainText('Personal Tax');
  await expect(active).toContainText('Tax Planning');
  await expect(active).not.toContainText('Bookkeeping');
  await expect(active.getByRole('link', { name: 'Open Tax Returns' })).toBeVisible();
  const recent = page.getByTestId('recent-activity');
  await expect(recent.getByTestId('activity-entry').first()).toContainText(
    'Organizer reminder (sample)',
  );
  await expect(page.getByRole('link', { name: 'View All' })).toHaveAttribute(
    'href',
    `/clients/${jamie}/activity`,
  );
  await page.screenshot({ path: `${shots}/overview.png`, fullPage: true });

  // Services: every enrollment with its status.
  await tabs.getByRole('link', { name: 'Services', exact: true }).click();
  const services = page.getByTestId('client-services');
  await expect(services.getByTestId('client-service')).toHaveCount(3);
  await expect(services).toContainText('Completed');
  await page.screenshot({ path: `${shots}/services.png` });

  // Intake Forms, Tasks and Notes: the modules' own lists for this client.
  await tabs.getByRole('link', { name: 'Intake Forms', exact: true }).click();
  await expect(page.getByTestId('client-intakes')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send an Intake Form' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page.getByTestId('client-tasks')).toBeVisible();
  await tabs.getByRole('link', { name: 'Notes', exact: true }).click();
  await expect(page.getByTestId('client-notes')).toContainText('Internal notes');

  // More: Signatures.
  await page.getByRole('button', { name: 'More client sections' }).click();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/more.png` });
  await page.getByRole('menuitem', { name: 'Signatures' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${jamie}/signatures`));
  await expect(page.getByRole('button', { name: 'More client sections' })).toContainText(
    'More: Signatures',
  );

  // A service tab leaves for its module and comes back.
  await tabs.getByRole('link', { name: 'Tax Returns' }).click();
  await expect(page).toHaveURL(/\/tax-returns\?from=/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${jamie}/signatures`));
});
