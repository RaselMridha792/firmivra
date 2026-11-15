import { test } from '@playwright/test';
import { checkLayout, port } from './r60-layout-check';

// R60, the lead's follow-up to Octavia's overlap report: the Appointments screens through the
// shared check (r60-layout-check.ts) at 768, 1165 (her tested desktop) and 1440 with the side menu
// expanded and collapsed, then 390; the client portal's Appointments (no side menu) at each width.
// Mock mode as the Owner and as the LVP client. Synthetic data only.
const APPOINTMENT = '0199c0b0-0a10-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-appointments-layout';
const widths = [768, 1165, 1440];
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.describe.configure({ timeout: 300_000 });
test.use({ timezoneId: 'America/New_York' });

const PAGES: [string, string][] = [
  ['calendar', '/calendar'],
  ['today', '/calendar/today'],
  ['list', '/calendar/list'],
  ['detail', `/calendar/${APPOINTMENT}`],
  ['edit', `/calendar/${APPOINTMENT}/edit`],
  ['schedule-form', '/calendar/new'],
  ['availability', '/calendar/availability'],
  ['types', '/calendar/types'],
];

for (const [name, path] of PAGES) {
  test(`${name}: no overlap or sideways scroll, menu open and closed, and at 390`, async ({
    page,
  }) => {
    await checkLayout(page, { name, path, shots, widths });
  });
}

test('portal appointments: no overlap or sideways scroll at each width and 390', async ({
  page,
}) => {
  await checkLayout(page, {
    name: 'portal-appointments',
    path: '/lvp/appointments',
    shots,
    widths,
    url: portal,
    menu: false,
  });
});
