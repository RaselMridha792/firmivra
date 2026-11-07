import { expect, test, type Locator, type Page } from '@playwright/test';

// R60, TP-F06 (Octavia's Oct 28 Templates review, and R1's reading of the dev logs: no request
// reached the API). The real client code against the local API and s3mock, as LVP's Owner: a
// valid PNG and PDF, a PDF whose name ends in upper case, and files the browser gives no type are
// attached, listed after a reload, and downloadable; a .txt, an 11 MB PDF and a file the browser
// cannot read say why, with nothing sent. Needs Docker's Postgres and s3mock (S3_ENDPOINT),
// migrated and seeded.
test.describe.configure({ timeout: 300_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** A valid 1x1 PNG (70 bytes). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);
/** A valid one-page PDF. */
const PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
);

/**
 * Picks a file the browser gives no type (`File.type` ''), as some do for a file dragged in or
 * from a cloud folder. Playwright's own `setInputFiles` fills the type in from the name.
 */
async function pickTypeless(input: Locator, name: string, buffer: Buffer) {
  await input.evaluate(
    (el, file) => {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const picked = new DataTransfer();
      picked.items.add(new File([bytes], file.name, { type: '' }));
      (el as HTMLInputElement).files = picked.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { name, base64: buffer.toString('base64') },
  );
}

/** A new private email template of LVP's, made through the API as the page's own session. */
async function newTemplate(page: Page): Promise<string> {
  const id = await page.evaluate(async (name) => {
    const res = await fetch('/api/v1/business/templates', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'EMAIL',
        name,
        subject: 'Fake attachments subject',
        body: '<p>Fake attachments body.</p>',
      }),
    });
    const json = (await res.json()) as { id?: string };
    return res.ok ? (json.id ?? null) : `${res.status} ${JSON.stringify(json)}`;
  }, `Fake attachments ${Date.now()}`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id!;
}

test('TP-F06: PNG, PDF, upper-case and typeless files are attached, kept and downloadable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const starts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/attachments\/uploads$/.test(r.url())) starts.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(app('/sign-in'));
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const id = await newTemplate(page);
  await page.goto(app(`/templates/${id}/edit`));
  const zone = page.getByTestId('attachments');
  const input = zone.locator('input[type="file"]');
  await expect(input).toBeAttached({ timeout: 120_000 });

  const files = [
    { name: 'tiny.png', mimeType: 'image/png', buffer: PNG },
    { name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'SCAN.PDF', mimeType: 'application/pdf', buffer: PDF },
    // No type from the browser: the name's ending decides, in any case.
    { name: 'no-type.pdf', mimeType: '', buffer: PDF },
    { name: 'PHOTO.PNG', mimeType: '', buffer: PNG },
  ];
  for (const file of files) {
    if (file.mimeType) await input.setInputFiles(file);
    else await pickTypeless(input, file.name, file.buffer);
    await expect(page.getByText('Attachment added.')).toBeVisible({ timeout: 60_000 });
    await expect(zone.getByText(file.name, { exact: true })).toBeVisible();
    // The next message must be its own.
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(page.getByText('Attachment added.')).toBeHidden();
  }
  expect(starts).toHaveLength(files.length);

  // Kept after a reload, and each one downloads.
  await page.reload();
  for (const file of files) {
    await expect(zone.getByText(file.name, { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  // The download is a short-lived link to the firm's own prefix in storage.
  const [file] = await Promise.all([
    page.waitForResponse((r) => /\/tenant\/[0-9a-f-]{36}\/templates\/[^/?]+\?/.test(r.url()), {
      timeout: 60_000,
    }),
    zone.getByRole('button', { name: 'Download SCAN.PDF' }).click(),
  ]);
  expect(file.status()).toBe(200);
  expect(file.url()).toMatch(/\/tenant\/[0-9a-f-]{36}\/templates\//);
  if (!page.url().endsWith(`/templates/${id}/edit`)) await page.goto(app(`/templates/${id}/edit`));
  await expect(input).toBeAttached({ timeout: 60_000 });

  // Refused in words before anything is sent.
  const before = starts.length;
  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'),
  });
  await expect(
    page.getByText('notes.txt is not a PDF, DOCX, XLSX, JPG or PNG file.'),
  ).toBeVisible();
  await input.setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25),
  });
  await expect(page.getByText('big.pdf is larger than 10 MB.')).toBeVisible();
  // A file the browser cannot read (a OneDrive placeholder not on this computer): named, not
  // "Something went wrong".
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function (this: File) {
      return this.name === 'cloud-only.pdf'
        ? Promise.reject(new DOMException('The file could not be read', 'NotReadableError'))
        : read.call(this);
    };
  });
  await input.setInputFiles({ name: 'cloud-only.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('This file could not be read.', { exact: false })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(starts).toHaveLength(before);
  expect(errors).toEqual([]);
});
