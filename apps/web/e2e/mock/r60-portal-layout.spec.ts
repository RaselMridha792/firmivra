import { test } from '@playwright/test';

// R60, Octavia's report of Nov 14: "lots of overlap in client portal module when the side menu is
// expanded". Every Client Portal screen and the Clients tab, at 1280, 1366 and 1440 with the
// sidebar expanded and collapsed, and at 390: no sideways scroll, no text spilling out of its card,
// and the client header's name never under its actions. Screenshots at 1280 with the sidebar
// expanded. Mock mode as the Owner; client 1 is Jamie Sample. Synthetic data only.
import { checkLayout } from './r60-layout-check';

const jamie = '0199b6a1-0000-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-portal-layout';

test.describe.configure({ timeout: 300_000 });

const PAGES: [string, string, string][] = [
  ['portal-overview', `/client-portal?client=${jamie}`, 'client-panel'],
  ['portal-documents', `/client-portal?client=${jamie}&tab=documents`, 'document-kpis'],
  ['portal-messages', `/client-portal?client=${jamie}&tab=messages`, 'client-panel'],
  ['portal-appointments', `/client-portal?client=${jamie}&tab=appointments`, 'client-panel'],
  ['portal-tax-returns', `/client-portal?client=${jamie}&tab=tax-returns`, 'client-panel'],
  ['portal-invoices', `/client-portal?client=${jamie}&tab=invoices`, 'client-panel'],
  ['portal-forms', `/client-portal?client=${jamie}&tab=intake-forms`, 'form-kpis'],
  ['manage-overview', `/client-portal/${jamie}`, 'client-portal-manage'],
  ['manage-access', `/client-portal/${jamie}/access`, 'client-portal-manage'],
  ['manage-content', `/client-portal/${jamie}/content`, 'client-portal-manage'],
  ['manage-documents', `/client-portal/${jamie}/documents`, 'client-portal-manage'],
  ['manage-forms', `/client-portal/${jamie}/forms`, 'client-portal-manage'],
  ['manage-communications', `/client-portal/${jamie}/communications`, 'client-portal-manage'],
  ['manage-activity', `/client-portal/${jamie}/activity`, 'client-portal-manage'],
  ['manage-preview', `/client-portal/${jamie}/preview`, 'portal-preview'],
  ['clients', '/clients', 'page-title'],
  ['client-record', `/clients/${jamie}`, 'client-overview'],
  ['client-services', `/clients/${jamie}/services`, 'client-services'],
];

for (const [name, path, ready] of PAGES) {
  test(`${name}: no overlap or sideways scroll, sidebar expanded and collapsed`, async ({
    page,
  }) => {
    await checkLayout(page, { name, path, ready, shots });
  });
}
