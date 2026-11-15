import { expect, test } from '@playwright/test';

// R1, Clients batch B (Clients Review 2, R55's independent check): the Client ID on the list and
// the profile, and the search hint that names it and says how to type a phone (N8-06). Mock mode
// as the Owner; client 1 is Jamie Sample, CL-10001. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('§3 and N8-06: the Client ID shows on the list and the profile; the hint names it and the phone rule', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('client-search-hint')).toHaveText(
    'Search by name, email, company or Client ID (CL-10024). Phone: type numbers only, e.g. 5551234567.',
    { timeout: 60_000 },
  );
  await expect(
    page.getByTestId('client-id').filter({ hasText: 'Client ID CL-10001' }).first(),
  ).toBeVisible();

  await page.goto(app(`/clients/${JAMIE}`));
  await expect(page.getByTestId('client-id')).toHaveText('Client ID CL-10001', {
    timeout: 60_000,
  });
});

test('§3/§6: Send Intake Form and Schedule Appointment open with the client chosen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The profile: Schedule Appointment and the Intake Forms tab's link carry the client.
  await page.goto(app(`/clients/${JAMIE}`));
  await expect(page.getByRole('link', { name: 'Schedule Appointment' })).toHaveAttribute(
    'href',
    new RegExp(`^/calendar/new[?]clientId=${JAMIE}`),
    { timeout: 60_000 },
  );
  await page.goto(app(`/clients/${JAMIE}/intake-forms`));
  await expect(page.getByRole('link', { name: 'Send an Intake Form' })).toHaveAttribute(
    'href',
    new RegExp(`^/intake-forms/send[?]clientId=${JAMIE}`),
    { timeout: 60_000 },
  );

  // The list's row menu: Send Intake Form opens the send screen on Jamie.
  await page.goto(app('/clients'));
  await page
    .getByRole('button', { name: 'More actions for Jamie Sample' })
    .first()
    .click({ timeout: 60_000 });
  await expect(page.getByRole('menuitem', { name: 'Schedule Appointment' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Send Intake Form' }).click();
  await expect(page).toHaveURL(new RegExp(`/intake-forms/send[?]clientId=${JAMIE}`), {
    timeout: 60_000,
  });
  await expect(page.getByTestId('send-summary')).toContainText('Jamie Sample', {
    timeout: 60_000,
  });
});

/** Fills Add New Client with a valid new client, then sends it. */
async function addClient(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.goto(app('/clients?new=1'));
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Full name *').fill(name);
  const local = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  await dialog.getByLabel('Email *').fill(`${local}@example.test`);
  await dialog.getByLabel('Phone *').fill(phone);
  await dialog.getByLabel('Street address *').fill('1 Fake Way');
  await dialog.getByLabel('City *').fill('Atlanta');
  await dialog.getByLabel('State *').selectOption('GA');
  await dialog.getByLabel('ZIP code *').fill('30301');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  return dialog;
}

test('§5: each possible duplicate shows its type, email or phone, staff, status and why', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await addClient(page, 'Jamie Lookalike (fake)', '(404) 555-0123');
  const duplicate = page.getByRole('dialog', { name: 'Possible duplicate client' });
  const facts = duplicate.getByTestId('duplicate-facts').first();
  await expect(facts).toContainText('Individual');
  await expect(facts).toContainText('Same phone number');
  await expect(facts).toContainText(/Assigned to |Unassigned/);
  await expect(duplicate.getByTestId('duplicate-matches')).toContainText('CL-10001');
});
