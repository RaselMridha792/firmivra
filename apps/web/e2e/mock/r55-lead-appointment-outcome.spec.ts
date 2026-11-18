import { expect, type Page, test } from '@playwright/test';

// P4-2 (Clients Review 2 N8-18, with N8-19's check): Mark Completed on a lead's own appointment
// asks what came of it (Keep as Lead, Keep as Lead and Follow Up with its date, Convert to New
// client) and for notes; a client's appointment asks for neither. In mock mode
// (playwright.mock.config.ts) as the Owner. The clock is fixed on a Saturday, so the week's seeded
// appointments have started: Ravi Greenwood's (a lead the leads mock holds, Qualified) on Thursday
// and Avery Lawson's (a client) on Monday. The mocks record the outcome as the API does: the
// appointment's notes, the lead's activity and follow-up; nothing converts. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const leadAppointment = `${base}/calendar/0199c0b0-0a10-7000-8000-000000000011`;
const clientAppointment = `${base}/calendar/0199c0b0-0a10-7000-8000-000000000001`;
const leadId = '0199c0c0-0a00-7000-8000-000000000005';

async function openComplete(page: Page, url: string) {
  await page.clock.setFixedTime(new Date('2026-11-21T17:00:00Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const close = page.getByTestId('detail-close');
  await expect(close.getByRole('button', { name: 'Mark Completed' })).toBeEnabled({
    timeout: 60_000,
  });
  await close.getByRole('button', { name: 'Mark Completed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark Completed' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('N8-18: a lead’s appointment needs an outcome and notes; Follow Up needs its date and sets the lead’s next follow-up', async ({
  page,
}) => {
  const dialog = await openComplete(page, leadAppointment);
  await expect(page.getByTestId('detail-summary')).toContainText('Ravi Greenwood');
  const outcome = dialog.getByRole('group', { name: 'Outcome' });
  await expect(outcome.getByRole('radio')).toHaveCount(3);
  for (const name of ['Keep as Lead', 'Keep as Lead and Follow Up', 'Convert to New client']) {
    await expect(outcome.getByRole('radio', { name, exact: true })).toBeVisible();
  }

  // Nothing chosen: the outcome and the notes are asked for, and nothing is saved.
  await dialog.getByRole('button', { name: 'Mark Completed' }).click();
  await expect(dialog).toContainText('Choose the outcome');
  await expect(dialog).toContainText('Add notes about the appointment');

  await outcome.getByRole('radio', { name: 'Keep as Lead and Follow Up' }).check();
  await dialog.getByLabel('Notes').fill('Fake: wants to compare prices, call back Tuesday');
  await dialog.getByRole('button', { name: 'Mark Completed' }).click();
  await expect(dialog).toContainText('Choose the follow-up date');
  await dialog.getByLabel('Follow-up date').fill('2026-11-24');
  await dialog.getByRole('button', { name: 'Mark Completed' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('detail-result')).toHaveText(
    'The appointment is marked completed: Keep as Lead and Follow Up.',
  );
  await expect(page.getByTestId('detail-notes')).toContainText(
    'Outcome: Keep as Lead and Follow Up (follow up on 2026-11-24). Fake: wants to compare prices',
  );
  await expect(page.getByTestId('detail-summary')).toContainText('Completed');
  await expect(
    page.getByTestId('detail-close').getByRole('button', { name: 'Mark Completed' }),
  ).toBeDisabled();

  // The lead (reached in the app, so the mocks keep what was saved): its next follow-up is that
  // day, its stage unchanged, and the outcome is on its activity.
  await page.getByRole('link', { name: 'Leads', exact: true }).first().click();
  await page
    .getByRole('link', { name: /Ravi Greenwood/ })
    .first()
    .click();
  await expect(page.getByTestId('lead-name')).toHaveText('Ravi Greenwood', { timeout: 60_000 });
  await expect(page.getByTestId('figure-next-follow-up')).toContainText('Follow Up');
  await expect(page.getByText('Qualified', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('card-recent-activity')).toContainText(
    'Appointment completed: Keep as Lead and Follow Up',
  );
});

test('N8-18: Convert to New client opens the lead’s Convert page with Back; the lead is still a lead', async ({
  page,
}) => {
  const dialog = await openComplete(page, leadAppointment);
  await dialog
    .getByRole('group', { name: 'Outcome' })
    .getByRole('radio', { name: 'Convert to New client' })
    .check();
  await dialog.getByLabel('Notes').fill('Fake: chose Payroll Setup');
  await dialog.getByRole('button', { name: 'Mark Completed' }).click();

  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}/convert\\?from=`), {
    timeout: 60_000,
  });
  await expect(page.getByTestId('back-to-origin')).toHaveText(/Back to Appointments/);
  // Nothing converted by the meeting: Cancel goes to the lead, still Qualified, with the outcome
  // on its activity.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}$`), { timeout: 60_000 });
  await expect(page.getByTestId('lead-name')).toHaveText('Ravi Greenwood');
  await expect(page.getByText('Qualified', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('card-recent-activity')).toContainText(
    'Appointment completed: Convert to New client',
  );
});

test('N8-18: a client’s appointment completes with no outcome asked', async ({ page }) => {
  const dialog = await openComplete(page, clientAppointment);
  await expect(dialog.getByRole('group', { name: 'Outcome' })).toHaveCount(0);
  await expect(dialog.getByLabel('Notes')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Mark Completed' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('detail-result')).toHaveText(
    'The appointment is marked completed.',
  );
});
