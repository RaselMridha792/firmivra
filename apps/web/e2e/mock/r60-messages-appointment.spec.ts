import { expect, test } from '@playwright/test';

// R60, MSG-F21 (Octavia's Oct 27 Messages review; the lead's Q3, Nov 7): an appointment's Send
// Message opens New Message with the client chosen and the appointment in Related To, and Back
// returns to the appointment. Mock mode, as an Owner. The mock's appointments name contacts the
// clients mock does not hold, so the link is read from one appointment and New Message is opened
// with it for client 1, whose records include an appointment.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const appointment = (n: number) => `0199c0b0-0a10-7000-8000-${String(n).padStart(12, '0')}`;
const CLIENT = '0199b6a1-0000-7000-8000-000000000001';
const RELATED = '0199b6c3-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 120_000 });

test("a client's appointment links to New Message for that client and appointment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/calendar/${appointment(1)}`));
  const actions = page.getByTestId('detail-actions');
  const send = actions.getByRole('link', { name: 'Send Message' });
  await expect(send).toBeVisible({ timeout: 60_000 });
  const href = new URL((await send.getAttribute('href'))!, app('/'));
  expect(href.pathname).toBe('/messages/new');
  expect(href.searchParams.get('clientId')).toBe('0199c0b0-1c00-7000-8000-000000000001');
  expect(href.searchParams.get('related')).toBe(`appointment:${appointment(1)}`);
  expect(href.searchParams.get('from')).toBe(`/calendar/${appointment(1)}`);

  // A lead's appointment and a team meeting have no client to message.
  for (const n of [9, 4]) {
    await page.goto(app(`/calendar/${appointment(n)}`));
    await expect(
      page.getByTestId('detail-actions').getByRole('link', { name: 'Edit' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('detail-actions').getByRole('link', { name: 'Send Message' }),
    ).toHaveCount(0);
  }
});

test('New Message opens with the client chosen and the appointment in Related To; Back returns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const from = `/calendar/${appointment(1)}`;
  await page.goto(app(`/calendar/${appointment(1)}`));
  await expect(page.getByTestId('detail-actions')).toBeVisible({ timeout: 60_000 });
  await page.goto(
    app(
      `/messages/new?clientId=${CLIENT}&related=appointment:${RELATED}&from=${encodeURIComponent(from)}`,
    ),
  );
  const related = page.getByTestId('compose-related').getByLabel(/Related To/);
  await expect(related).toHaveValue(`appointment:${RELATED}`, { timeout: 60_000 });
  await expect(related.locator('option:checked')).toHaveText('Appointment, Nov 12, 2026');
  await page.screenshot({
    path: 'e2e/screenshots/r60-messages-appointment/r60-messages-appointment.png',
  });

  // Something not this client's is never kept.
  await page.goto(app(`/messages/new?clientId=${CLIENT}&related=appointment:${appointment(2)}`));
  await expect(page.getByTestId('compose-related').getByLabel(/Related To/)).toHaveValue('', {
    timeout: 60_000,
  });

  // Back returns to the appointment.
  await page.goto(
    app(
      `/messages/new?clientId=${CLIENT}&related=appointment:${RELATED}&from=${encodeURIComponent(from)}`,
    ),
  );
  const back = page.getByTestId('back-to-origin');
  await expect(back).toHaveText(/Back to Appointments/);
  await back.click();
  await expect(page).toHaveURL(app(from));
});
