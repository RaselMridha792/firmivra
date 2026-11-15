import { test } from '@playwright/test';
import { checkLayout } from './r60-layout-check';

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
