import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  Appointment,
  CancelAppointmentRequest,
  UpdateAppointmentDetailsRequest,
} from '@firmivra/types';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { createSchedulingMock } from '../../src/mocks/appointments-scheduling';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 27;
const appointmentId = '0199c0b0-0a10-7000-8000-000000000002';
const detailUrl = `http://app.localhost:${port}/calendar/${appointmentId}`;
const apiPath = `**/api/v1/business/appointments/${appointmentId}`;
const choices = [
  ['THIS', 'This appointment'],
  ['FOLLOWING', 'This and later appointments'],
  ['SERIES', 'All appointments in the series'],
] as const;

// Keep the workspace on mock data, but use the real appointments clients so the spec sees
// exactly what the Edit and Cancel controls send over HTTP. The responses are synthetic.
const modules = ['api.ts', 'auth.ts'].flatMap((file) =>
  [
    ...readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8').matchAll(
      /mocked\('(\w+)'\)/g,
    ),
  ].map((match) => match[1]),
);
const mockModules = [...new Set(modules)]
  .filter((name) => name !== 'appointments' && name !== 'scheduling')
  .join(',');

let server: ChildProcess | undefined;
test.beforeAll(async ({ request }) => {
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  server = spawn(process.execPath, [next, 'dev', '--port', String(port)], {
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WEB_PORT: String(port),
      NEXT_DIST_DIR: '.next/appointments-series-api',
      NEXT_PUBLIC_API_MOCK: mockModules,
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
    },
  });
  await expect
    .poll(
      async () => {
        if (server?.exitCode !== null) throw new Error('Appointments test server exited early');
        return request.get(`http://localhost:${port}/healthz`, { timeout: 2000 }).then(
          (response) => response.ok(),
          () => false,
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
});

test.afterAll(() => {
  if (!server?.pid) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  else if (server.exitCode === null) process.kill(-server.pid, 'SIGTERM');
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
});

async function stubAppointment(page: Page, series: boolean) {
  const scheduling = createSchedulingMock();
  const template = await scheduling.record(appointmentId);
  const record = {
    ...template,
    startsAt: '2026-10-21T15:00:00.000Z',
    endsAt: '2026-10-21T16:00:00.000Z',
    seriesId: series ? '0199c0b0-0a20-7000-8000-000000000001' : null,
    recurrence: series ? { frequency: 'WEEKLY' as const, count: 4, interval: 1 } : null,
  };
  await page.route('**/api/v1/business/appointments/options', async (route) =>
    route.fulfill({ json: await scheduling.options() }),
  );
  await page.route('**/api/v1/business/appointment-types/*/config', async (route) => {
    const typeId = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    await route.fulfill({ json: await scheduling.typeConfig(typeId) });
  });
  await page.route('**/api/v1/business/availability/day?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const day = await scheduling.staffDay({
      staffUserId: query.get('staffUserId') ?? '',
      date: query.get('date') ?? '',
    });
    await route.fulfill({ json: day });
  });
  await page.route(`${apiPath}/record`, (route) => route.fulfill({ json: record }));
  await page.route(`${apiPath}/details`, (route) => {
    const body = UpdateAppointmentDetailsRequest.parse(route.request().postDataJSON());
    record.internalNotes = body.internalNotes ?? null;
    return route.fulfill({ json: record });
  });
  await page.route(`${apiPath}/cancel`, (route) => {
    const body = CancelAppointmentRequest.parse(route.request().postDataJSON());
    record.status = 'CANCELED';
    return route.fulfill({
      json: Appointment.parse({
        ...record,
        client: { id: record.contact.id, displayName: record.contact.name },
        lead: null,
        staff: record.staff[0],
        engagementId: null,
        status: 'CANCELLED',
        locationKind: 'IN_PERSON',
        locationDetails: null,
        bookedByClient: false,
        rescheduleCount: 0,
        cancelledAt: '2026-10-14T16:00:00.000Z',
        cancelReason: body.reason ?? null,
      }),
    });
  });
}

async function chooseScope(scope: Locator, label: string) {
  for (const [, choice] of choices) await expect(scope.getByLabel(choice)).toBeVisible();
  await expect(scope.getByLabel('This appointment')).toBeChecked();
  await scope.getByLabel(label).check();
  await expect(scope.getByLabel(label)).toBeChecked();
}

for (const [scope, label] of choices) {
  test(`R2: Edit submits ${label}`, async ({ page }) => {
    await stubAppointment(page, true);
    await page.goto(`${detailUrl}/edit`);
    await chooseScope(page.getByTestId('edit-scope'), label);
    await page.getByLabel('Internal Notes (not visible to client)').fill('Synthetic scope edit');
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().endsWith(`/${appointmentId}/details`) && r.method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Save Changes' }).press('Enter'),
    ]);
    const body = UpdateAppointmentDetailsRequest.parse(request.postDataJSON());
    expect(body.scope ?? 'THIS').toBe(scope);
    expect(body.internalNotes).toBe('Synthetic scope edit');
    if (scope !== 'THIS') expect(body.recurrence).toBeUndefined();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.getByTestId('detail-notes')).toContainText('Synthetic scope edit');
  });

  test(`R2: Cancel submits ${label}`, async ({ page }) => {
    await stubAppointment(page, true);
    await page.goto(detailUrl);
    await page.getByRole('button', { name: 'Cancel Appointment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Appointment' });
    await chooseScope(dialog.getByTestId('cancel-scope'), label);
    await dialog.getByLabel('Reason (optional)').fill('Synthetic cancellation');
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().endsWith(`/${appointmentId}/cancel`) && r.method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Cancel Appointment' }).click(),
    ]);
    expect(CancelAppointmentRequest.parse(request.postDataJSON())).toEqual({
      scope,
      reason: 'Synthetic cancellation',
    });
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Canceled', { exact: true })).toBeVisible();
  });
}

test('R2: a one-off appointment has no scope question', async ({ page }) => {
  await stubAppointment(page, false);
  await page.goto(`${detailUrl}/edit`);
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
  await expect(page.getByTestId('edit-scope')).toHaveCount(0);
  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Cancel Appointment' }).click();
  await expect(page.getByRole('dialog', { name: 'Cancel Appointment' })).toBeVisible();
  await expect(page.getByTestId('cancel-scope')).toHaveCount(0);
});
