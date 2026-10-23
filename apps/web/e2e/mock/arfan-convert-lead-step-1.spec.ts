import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const basePort = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const leadId = '0199c0c0-0a00-7000-8000-000000000001';
const url = (port: number) => `http://app.localhost:${port}/leads/${leadId}/convert`;
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

function everyMockExceptLeadPipeline() {
  const names = ['api.ts', 'auth.ts'].flatMap((file) =>
    [
      ...readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8').matchAll(
        /mocked\('(\w+)'\)/g,
      ),
    ].map((match) => match[1]),
  );
  return [...new Set(names)].filter((name) => name !== 'leadPipeline').join(',');
}

async function startMockServer(name: 'empty' | 'unreachable', port: number): Promise<ChildProcess> {
  const env =
    name === 'empty'
      ? { NEXT_PUBLIC_API_MOCK: 'all', NEXT_PUBLIC_API_MOCK_EMPTY: 'leadPipeline' }
      : { NEXT_PUBLIC_API_MOCK: everyMockExceptLeadPipeline() };
  const server = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEB_PORT: String(port),
      NEXT_DIST_DIR: `.next/mock-convert-${name}`,
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
      ...env,
    },
  });

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const healthy = await fetch(`http://localhost:${port}/healthz`).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) return server;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Mock web server (${name}) did not start`);
}

function stopMockServer(server: ChildProcess | undefined) {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid);
    }
  } catch {
    // The process tree already stopped.
  }
}

async function expectFrames(page: Page) {
  for (const id of [
    'convert-lead-lead-info',
    'convert-lead-details',
    'convert-lead-client-fields',
    'convert-lead-staff-assignment',
    'convert-lead-carry-over',
    'convert-lead-portal-access',
    'convert-lead-after-conversion',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'What to Carry Over' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'After Conversion' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Convert lead progress' })).toBeVisible();
}

async function captureReview(page: Page, filename: string) {
  await page.screenshot({
    path: test.info().outputPath(filename),
    fullPage: true,
    style: '[data-testid="mock-badge"] { display: none !important; }',
  });
}

test('shows the complete conversion review and responsive layout with mock data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url(basePort));

  await expect(page).toHaveTitle(/^Convert lead: Review lead information/);
  await expect(page.getByTestId('page-title')).toHaveText('Convert Lead to Client');
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  await expectFrames(page);
  await expect(page.getByText('Avery Lawson', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Full Name *')).toHaveValue('Avery Lawson');
  // An editable picker now (Octavia's review, item 16): the lead's staff member is chosen.
  await expect(page.getByLabel('Primary Staff Member *').locator('option:checked')).toHaveText(
    'Morgan Avery',
  );
  await captureReview(page, 'convert-lead-data-1440.png');

  await page.getByRole('button', { name: 'Review & Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}/convert/details$`));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url(basePort));
  await expectFrames(page);
  const dimensions = await page.getByTestId('convert-lead-page').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await captureReview(page, 'convert-lead-data-375.png');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}$`));
});

test('keeps every section frame when the lead data is empty', async ({ page }) => {
  const server = await startMockServer('empty', basePort + 1);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(basePort + 1));

    await expectFrames(page);
    await expect(page.getByText("This lead couldn't be found.")).toBeVisible();
    await expect(page.getByText('Personal Tax', { exact: true }).first()).toBeVisible();
    await captureReview(page, 'convert-lead-empty-1440.png');
  } finally {
    stopMockServer(server);
  }
});

test('keeps every section frame when the lead API is unreachable', async ({ page }) => {
  const server = await startMockServer('unreachable', basePort + 1);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/api/v1/business/leads/**', (route) => route.abort());
    await page.goto(url(basePort + 1));

    await expectFrames(page);
    await expect(page.getByText("Couldn't load lead information.")).toBeVisible();
    await expect(page.getByText("Couldn't load service options.")).toBeVisible();
    await captureReview(page, 'convert-lead-unreachable-1440.png');
  } finally {
    stopMockServer(server);
  }
});
