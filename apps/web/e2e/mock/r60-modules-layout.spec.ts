import { test } from '@playwright/test';
import { checkLayout } from './r60-layout-check';

// R60, the lead's follow-up to Octavia's report of Nov 14 (overlap with the side menu expanded):
// the other modules she has as ready, Leads, Bookkeeping and Payroll, through the same check as
// the Client Portal (r60-layout-check.ts): 1280, 1366 and 1440 with the sidebar expanded and
// collapsed, and 390. Mock mode as the Owner. Synthetic data only.
const LEAD = '0199c0c0-0a00-7000-8000-000000000001';
const BOOKS = '0199c0f0-b100-7000-8000-000000000001';
const PAYROLL = '0199c0f0-9c00-7000-8000-000000000001';
const RUN = '0199c0f0-9d00-7000-8000-000000000109';
const shots = 'e2e/screenshots/r60-modules-layout';

test.describe.configure({ timeout: 300_000 });

const PAGES: [string, string][] = [
  ['leads', '/leads'],
  ['lead-workspace', `/leads/${LEAD}`],
  ['lead-duplicates', '/leads/duplicates'],
  ['lead-import', '/leads/import'],
  ['reports-leads', '/reports/leads'],
  ['bookkeeping', '/bookkeeping'],
  ['bookkeeping-client', `/bookkeeping/clients/${BOOKS}`],
  ['bookkeeping-transactions', `/bookkeeping/clients/${BOOKS}?tab=transactions`],
  ['bookkeeping-reconciliation', `/bookkeeping/clients/${BOOKS}?tab=reconciliation`],
  ['bookkeeping-documents', `/bookkeeping/clients/${BOOKS}?tab=documents`],
  ['bookkeeping-client-reports', `/bookkeeping/clients/${BOOKS}?tab=reports`],
  ['bookkeeping-reports', '/bookkeeping/reports'],
  ['payroll', '/payroll'],
  ['payroll-client', `/payroll/clients/${PAYROLL}`],
  ['payroll-run', `/payroll/runs/${RUN}`],
];

for (const [name, path] of PAGES) {
  test(`${name}: no overlap or sideways scroll, sidebar expanded and collapsed`, async ({
    page,
  }) => {
    await checkLayout(page, { name, path, shots });
  });
}
