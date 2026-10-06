/* global document */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const origin = `http://${process.env['ADMIN_HOST'] ?? 'admin.localhost'}:${process.env['WEB_PORT'] ?? '3000'}`;

const output = new URL('../../../docs/design/review/exact/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const cases = [
  ['admin-login', '/sign-in', 1536, 1024, 'super-admin/Super login.png'],
  ['admin-dashboard', '/?preview=1', 1536, 1024, 'super-admin/Dashboard Active .png'],
  ['admin-applications', '/applications?preview=1', 1672, 941, 'super-admin/Firm application.png'],
  [
    'admin-application-open',
    '/applications/sample-application?preview=1',
    1536,
    1024,
    'super-admin/When firm aplication is open.png',
  ],
  [
    'admin-firm-approved',
    '/firms/sample-firm?preview=1',
    1536,
    1024,
    'super-admin/Firm approved.png',
  ],
];
await page.goto(`${origin}/sign-in?dev=1`);
await page.getByRole('button', { name: /superadmin@firmivra.test/ }).click();
await page.getByTestId('me-email').waitFor();
const bounds = [];
for (const [name, path, width, height, reference] of cases) {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}${path}`);
  await page
    .getByRole('heading', {
      name:
        name === 'admin-login'
          ? 'Welcome Back'
          : name === 'admin-dashboard'
            ? /Welcome back/
            : name === 'admin-firm-approved'
              ? 'Firms'
              : 'Firm Applications',
      exact: name !== 'admin-dashboard',
    })
    .waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((image) => image.getBoundingClientRect().width > 0)
        .map((image) => {
          image.loading = 'eager';
          return image.decode().catch(() => {});
        }),
    );
  });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, output)),
    fullPage: true,
  });
  bounds.push({
    name,
    reference,
    width,
    height,
    actual: await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      elements: Array.from(
        document.querySelectorAll(
          'h1,h2,.ref-login-card,.ref-admin-sidebar,.ref-summary-grid,.ref-table-region,.ref-record-detail',
        ),
      ).map((node) => ({
        element: node.className || node.tagName,
        bounds: node.getBoundingClientRect().toJSON(),
      })),
    })),
  });
}
for (const [name, path] of cases) {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${origin}${path}`);
  await page
    .getByRole('heading', {
      name:
        name === 'admin-login'
          ? 'Welcome Back'
          : name === 'admin-dashboard'
            ? /Welcome back/
            : name === 'admin-firm-approved'
              ? 'Firms'
              : 'Firm Applications',
      exact: name !== 'admin-dashboard',
    })
    .waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((image) => image.getBoundingClientRect().width > 0)
        .map((image) => {
          image.loading = 'eager';
          return image.decode().catch(() => {});
        }),
    );
  });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}-mobile.png`, output)),
    fullPage: true,
  });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > 375) throw new Error(`${name}: mobile page overflows to ${width}px`);
}
await writeFile(new URL('bounds.json', output), JSON.stringify(bounds, null, 2));
await browser.close();
process.stdout.write(
  'Captured five reference-size screens and five mobile screens without page overflow.\n',
);
