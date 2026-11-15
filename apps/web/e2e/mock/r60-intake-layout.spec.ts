import { test } from '@playwright/test';
import { checkLayout, port } from './r60-layout-check';

// R60, Intake Forms Review Two (her pending "Mobile layout: developer to verify"): the Intake
// screens through the shared check (r60-layout-check.ts) at 768, 1165 (her tested desktop width)
// and 1440 with the sidebar expanded and collapsed, then 390. Mock mode as the Owner. Synthetic.
const FORM = '0199c0d0-0a00-7000-8000-000000000003';
const TEMPLATE = '0199c0d0-0f00-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-intake-layout';
const widths = [768, 1165, 1440];

test.describe.configure({ timeout: 300_000 });

const PAGES: [string, string][] = [
  ['list', '/intake-forms'],
  ['templates', '/intake-forms/templates'],
  ['detail', `/intake-forms/${FORM}`],
  ['detail-responses', `/intake-forms/${FORM}/responses`],
  ['detail-documents', `/intake-forms/${FORM}/documents`],
  ['detail-history', `/intake-forms/${FORM}/history`],
  ['send', '/intake-forms/send'],
  ['settings', '/intake-forms/settings'],
  ['builder', `/intake-forms/builder/${TEMPLATE}`],
  ['builder-logic', `/intake-forms/builder/${TEMPLATE}/logic`],
  ['builder-preview', `/intake-forms/builder/${TEMPLATE}/preview`],
];

for (const [name, path] of PAGES) {
  test(`${name}: no overlap or sideways scroll, sidebar expanded and collapsed, and at 390`, async ({
    page,
  }) => {
    await checkLayout(page, { name, path, shots, widths });
  });
}

// R1, Review Two (P2-7): the recipient's own pages on the client portal's site, at 768 and 390:
// the portal form a client opens from its email, a lead's emailed link, and a shared link's start.
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const LINK_TOKEN = 'mock-intake-link-token-'.padEnd(43, '0');
const SHARE_TOKEN = '0199c0d00f0070008000000000000002mockshare00';
const RECIPIENT: [string, string, string | undefined][] = [
  ['portal-form', '/lvp/intake/0199b6a8-0000-7000-8000-000000000001', 'assigned-intake'],
  ['lead-link', `/lvp/form#token=${LINK_TOKEN}`, 'intake-link'],
  ['share-start', `/lvp/start/${SHARE_TOKEN}`, undefined],
];

for (const [name, path, ready] of RECIPIENT) {
  test(`${name}: the recipient's page has no overlap or sideways scroll at 768 and 390`, async ({
    page,
  }) => {
    await checkLayout(page, {
      name,
      path,
      shots,
      widths: [768],
      url: portal,
      menu: false,
      ...(ready ? { ready } : {}),
    });
  });
}
