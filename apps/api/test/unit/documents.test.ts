// R5 steps 2 to 4: the documents settings (SCAN_MODE), the presigned URLs (s3mock does not check
// signatures, so the URLs themselves are checked here), confirm's file checks with generated
// files, and one round trip through s3mock when it runs (docker compose up -d).
import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { loadDocumentsConfig } from '../../src/storage/config.js';
import {
  attachment,
  createS3Client,
  S3DocumentStorage,
} from '../../src/storage/document-storage.js';
import { checkFile } from '../../src/storage/file-checks.js';
import {
  cfb,
  contentTypes,
  DOCX,
  office,
  pdf,
  png,
  sha256,
  XLSX,
  zip,
  type ZipEntry,
} from '../office-files.js';

const BUCKET = 'firmivra-docs-local';
const base = { S3_DOCUMENTS_BUCKET: BUCKET };

describe('documents settings', () => {
  it('scans with GuardDuty unless SCAN_MODE=local, which only development and test allow', () => {
    expect(loadDocumentsConfig({ ...base, NODE_ENV: 'production' }).scanMode).toBe('guardduty');
    expect(loadDocumentsConfig({ ...base, NODE_ENV: 'test', SCAN_MODE: '' }).scanMode).toBe(
      'guardduty',
    );
    for (const NODE_ENV of ['development', 'test']) {
      expect(loadDocumentsConfig({ ...base, NODE_ENV, SCAN_MODE: 'local' }).scanMode).toBe('local');
    }
    for (const NODE_ENV of ['production', undefined]) {
      expect(() => loadDocumentsConfig({ ...base, NODE_ENV, SCAN_MODE: 'local' })).toThrow(
        /SCAN_MODE=local is only allowed/,
      );
    }
    expect(() => loadDocumentsConfig({ ...base, SCAN_MODE: 'skip' })).toThrow(/SCAN_MODE/);
  });

  it('needs the bucket, and refuses s3mock settings in production', () => {
    expect(() => loadDocumentsConfig({ NODE_ENV: 'test' })).toThrow(/S3_DOCUMENTS_BUCKET/);
    const local = { S3_ENDPOINT: 'http://localhost:9090', S3_ACCESS_KEY_ID: 'local' };
    expect(() => loadDocumentsConfig({ ...base, NODE_ENV: 'production', ...local })).toThrow(
      /S3_ENDPOINT[\s\S]*S3_ACCESS_KEY_ID/,
    );
    const dev = loadDocumentsConfig({
      ...base,
      ...local,
      NODE_ENV: 'development',
      S3_SECRET_ACCESS_KEY: 'local',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(dev).toMatchObject({
      endpoint: 'http://localhost:9090',
      forcePathStyle: true,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
  });
});

const storage = (endpoint = 'http://localhost:9090') =>
  new S3DocumentStorage(
    createS3Client({
      bucket: BUCKET,
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      scanMode: 'local',
    }),
    BUCKET,
  );
const key = () => `tenant/${randomUUID()}/documents/${randomUUID()}`;

describe('presigned URLs', () => {
  it('signs a PUT for exactly the content type, length and checksum, for 4 minutes', async () => {
    const file = pdf();
    const k = key();
    const put = await storage().presignUpload({
      key: k,
      contentType: 'application/pdf',
      sizeBytes: file.length,
      sha256: sha256(file),
    });
    const url = new URL(put.url);
    expect(url.pathname).toBe(`/${BUCKET}/${k}`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;x-amz-checksum-sha256',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('240');
    // Nothing the signature should cover rides in the query string instead.
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
    expect(put.headers).toEqual({
      'content-type': 'application/pdf',
      'x-amz-checksum-sha256': Buffer.from(sha256(file), 'hex').toString('base64'),
    });
  });

  it('signs a GET as an attachment with an RFC 5987 name and the stored type, for 5 minutes', async () => {
    const url = new URL(
      await storage().presignDownload({
        key: key(),
        fileName: 'Résumé "final" 100%.pdf',
        contentType: 'text/html',
      }),
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="R_sum_ _final_ 100_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%20100%25.pdf`,
    );
    // A type the API never accepts is served as one no browser renders.
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(attachment("it's (1).pdf")).toBe(
      `attachment; filename="it's (1).pdf"; filename*=UTF-8''it%27s%20%281%29.pdf`,
    );
  });
});

describe('the S3 adapter on errors', () => {
  const failing = (httpStatusCode: number) =>
    new S3DocumentStorage(
      {
        send: () =>
          Promise.reject(Object.assign(new Error('S3'), { $metadata: { httpStatusCode } })),
      } as unknown as S3Client,
      BUCKET,
    );

  it('reads 404 as no object, and throws on 403 (a KMS or access failure, never a missing file)', async () => {
    await expect(failing(404).read(key())).resolves.toBeNull();
    await expect(failing(403).read(key())).rejects.toThrow('S3');
    await expect(failing(500).read(key())).rejects.toThrow('S3');
    // HEAD has no s3:ListBucket behind it: 403 is how S3 says there is no such key.
    await expect(failing(403).head(key())).resolves.toBeNull();
  });
});

describe('confirm: the bytes are their type', () => {
  it('checks the first bytes of PDF, PNG and JPEG files', () => {
    expect(checkFile('application/pdf', pdf())).toBeNull();
    expect(checkFile('image/png', png())).toBeNull();
    expect(checkFile('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(checkFile('image/png', pdf())).toBe('UPLOAD_MISMATCH');
    expect(checkFile('application/pdf', Buffer.from('<html>'))).toBe('UPLOAD_MISMATCH');
    expect(checkFile('application/pdf', new Uint8Array())).toBe('UPLOAD_MISMATCH');
  });

  it('takes a real .xlsx and .docx, each only as its own type', () => {
    expect(checkFile(XLSX, office('xlsx'))).toBeNull();
    expect(checkFile(DOCX, office('docx'))).toBeNull();
    expect(checkFile(DOCX, office('xlsx'))).toBe('UPLOAD_MISMATCH');
    expect(checkFile(XLSX, office('docx'))).toBe('UPLOAD_MISMATCH');
    // Stored entries, names in other case or with a leading slash are still one package.
    const stored = office('xlsx', (parts) =>
      parts.map((p) => ({ ...p, method: 0, name: p.name.replace('workbook', 'WorkBook') })),
    );
    expect(checkFile(XLSX, stored)).toBeNull();
  });

  const xlsxWith = (change: (parts: ZipEntry[]) => ZipEntry[]) =>
    checkFile(XLSX, office('xlsx', change));
  const types = (overrides: Record<string, string>, extra?: string): ZipEntry => ({
    name: '[Content_Types].xml',
    data: contentTypes(overrides, extra),
  });
  const MAIN = `${XLSX}.main+xml`;

  it('refuses macros before looking at the main part (a renamed .xlsm or .docm)', () => {
    const xlsm = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
    expect(xlsxWith((p) => [types({ '/xl/workbook.xml': xlsm }), ...p.slice(1)])).toBe(
      'FILE_HAS_MACROS',
    );
    expect(xlsxWith((p) => [...p, { name: 'xl/vbaProject.bin', data: 'x' }])).toBe(
      'FILE_HAS_MACROS',
    );
    expect(xlsxWith((p) => [...p, { name: 'word\\VBADATA.xml', data: 'x' }])).toBe(
      'FILE_HAS_MACROS',
    );
    const sheet = 'application/vnd.ms-excel.macrosheet+xml';
    expect(
      xlsxWith((p) => [types({ '/xl/workbook.xml': MAIN, '/x.xml': sheet }), ...p.slice(1)]),
    ).toBe('FILE_HAS_MACROS');
    // Values are compared decoded: an escaped letter hides nothing.
    const escaped = 'application/vnd.ms-word.document.&#x6D;acroEnabled.main+xml';
    const docm = office('docx', (p) => [types({ '/word/document.xml': escaped }), ...p.slice(1)]);
    expect(checkFile(DOCX, docm)).toBe('FILE_HAS_MACROS');
    const docx = `${DOCX}.main+xml`;
    expect(
      checkFile(
        DOCX,
        office('docx', (p) => [...p, { name: 'word/vbaData.xml', data: docx }]),
      ),
    ).toBe('FILE_HAS_MACROS');
  });

  it('refuses a password-protected file, and any other CFB, as a password or a mismatch', () => {
    expect(checkFile(XLSX, cfb(['EncryptionInfo', 'EncryptedPackage']))).toBe(
      'FILE_PASSWORD_PROTECTED',
    );
    expect(checkFile(DOCX, cfb(['EncryptedPackage']))).toBe('FILE_PASSWORD_PROTECTED');
    // An old .xls or .doc renamed, and a broken CFB.
    expect(checkFile(XLSX, cfb(['Workbook']))).toBe('UPLOAD_MISMATCH');
    const broken = cfb(['EncryptedPackage']);
    broken.writeUInt16LE(10, 30); // a sector size Office never writes
    expect(checkFile(XLSX, broken)).toBe('UPLOAD_MISMATCH');
    const looped = cfb(['EncryptedPackage']);
    looped.writeUInt32LE(1, 512 + 4); // the directory chain points at itself: walked once
    expect(checkFile(XLSX, looped)).toBe('FILE_PASSWORD_PROTECTED');
  });

  it('refuses broken or unsafe packages as a mismatch', () => {
    const refusals: [string, Buffer][] = [
      ['not a ZIP', Buffer.from('PK but not really')],
      ['no content types', zip([{ name: 'xl/workbook.xml', data: '<x/>' }])],
      [
        'a DTD',
        office('xlsx', (p) => [
          types({ '/xl/workbook.xml': MAIN }, '<!DOCTYPE x [<!ENTITY e "y">]>'),
          ...p.slice(1),
        ]),
      ],
      [
        'an entity of its own',
        office('xlsx', (p) => [
          { ...p[0]!, data: contentTypes({ '/xl/workbook.xml': '&e;' }) },
          ...p.slice(1),
        ]),
      ],
      [
        'two entries with one name',
        office('xlsx', (p) => [...p, { ...p[2]!, name: 'XL/Workbook.xml' }]),
      ],
      ['ZIP encryption', office('xlsx', (p) => p.map((e) => ({ ...e, flags: 1 })))],
      [
        'another compression method',
        office('xlsx', (p) => p.map((e, i) => (i === 2 ? { ...e, method: 12 } : e))),
      ],
      ['a size that lies', office('xlsx', (p) => [{ ...p[0]!, claimedSize: 10 }, ...p.slice(1)])],
      ['no main part', office('xlsx', (p) => p.slice(0, 2))],
      [
        'a template (.xltx)',
        office('xlsx', (p) => [
          types({ '/xl/workbook.xml': `${XLSX.replace(/sheet$/, 'template')}.main+xml` }),
          ...p.slice(1),
        ]),
      ],
      ['a truncated file', office('xlsx').subarray(0, 60)],
    ];
    for (const [why, file] of refusals) expect(checkFile(XLSX, file), why).toBe('UPLOAD_MISMATCH');
  });

  it('reads [Content_Types].xml as a parser does: quoted ">", processing instructions, comments', () => {
    const MACRO_MAIN = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
    const VBA = 'application/vnd.ms-office.vbaProject';
    const parts = (xml: string, more: ZipEntry[] = []) =>
      checkFile(
        XLSX,
        zip([
          { name: '[Content_Types].xml', data: xml },
          { name: 'xl/workbook.xml', data: '<root/>' },
          { name: 'xl/sheet.xml', data: '<root/>' },
          ...more,
        ]),
      );
    const head = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="urn:fake">';
    const decoy = `<Override PartName="/xl/sheet.xml" ContentType="${MAIN}"/>`;
    // A ">" inside a quoted value ends no tag: the VBA part renamed to code.bin is still found.
    const quoted =
      `${head}<Default xmlns:x="a>b" Extension="bin" ContentType="${VBA}"/>` +
      `<Override xmlns:x="a>b" PartName="/xl/workbook.xml" ContentType="${MACRO_MAIN}"/>` +
      `${decoy}</Types>`;
    expect(parts(quoted, [{ name: 'xl/code.bin', data: 'x' }])).toBe('FILE_HAS_MACROS');
    // A processing instruction ends at "?>", whatever it holds; a "<!--" inside opens nothing.
    const pi =
      `${head}<?x <!-- ?><Override PartName="/xl/workbook.xml" ContentType="${MACRO_MAIN}"/>` +
      `<!-- -->${decoy}</Types>`;
    expect(parts(pi)).toBe('FILE_HAS_MACROS');
    // Without macros: what Office never writes on Default or Override is a mismatch.
    const main = `PartName="/xl/workbook.xml" ContentType="${MAIN}"`;
    for (const odd of [
      `<Override xmlns:x="a>b" ${main}/>`,
      `<x:Override xmlns:x="urn:fake" ${main}/>`,
      `<Override Foo="1" ${main}/>`,
    ]) {
      expect(parts(`${head}${odd}</Types>`), odd).toBe('UPLOAD_MISMATCH');
    }
    expect(parts(`${head}<Override ${main}/></Types>`)).toBeNull();
    // Not well-formed: refused, never read around.
    for (const broken of [
      `${head}<Override ${main}/><!-- open</Types>`,
      `${head}<Override ${main}/><?xml version="1.0"?></Types>`,
      `${head}<Override PartName='/a' PartName='/b' ContentType="${MAIN}"/></Types>`,
      `${head}<Override ${main} Extra="x<y"/></Types>`,
      `${head}<Override ${main}/></Types junk="1">`,
    ]) {
      expect(parts(broken), broken).toBe('UPLOAD_MISMATCH');
    }
  });

  it('caps what [Content_Types].xml inflates to at 1 MB, counted on the output', () => {
    const bomb = contentTypes({ '/xl/workbook.xml': MAIN }, `<!-- ${'a'.repeat(1_100_000)} -->`);
    const file = office('xlsx', (p) => [{ ...p[0]!, data: bomb }, ...p.slice(1)]);
    expect(file.length).toBeLessThan(10_000);
    expect(checkFile(XLSX, file)).toBe('UPLOAD_MISMATCH');
    // Comments are not declarations.
    const hidden = contentTypes(
      { '/xl/workbook.xml': MAIN },
      `<!-- <Override PartName="/x" ContentType="macroEnabled"/> -->`,
    );
    expect(xlsxWith((p) => [{ ...p[0]!, data: hidden }, ...p.slice(1)])).toBeNull();
  });
});

const s3mock = await fetch('http://localhost:9090/favicon.ico', {
  signal: AbortSignal.timeout(1000),
})
  .then(() => true)
  .catch(() => false);

describe.skipIf(!s3mock)('the S3 adapter against s3mock', () => {
  it('puts with the ticket, refuses other bytes, reads, links a download and deletes', async () => {
    const s3 = storage();
    const file = pdf('round trip');
    const k = key();
    const put = await s3.presignUpload({
      key: k,
      contentType: 'application/pdf',
      sizeBytes: file.length,
      sha256: sha256(file),
    });
    const send = (body: Buffer) => fetch(put.url, { method: 'PUT', headers: put.headers, body });
    expect((await send(pdf('other bytes'))).status).toBe(400);
    expect((await send(file)).status).toBe(200);
    expect(await s3.head(k)).toEqual({ sizeBytes: file.length, sha256: sha256(file) });
    expect(Buffer.from((await s3.read(k))!)).toEqual(file);
    const download = await fetch(
      await s3.presignDownload({
        key: k,
        fileName: 'W-2 2025.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(download.headers.get('content-disposition')).toBe(
      `attachment; filename="W-2 2025.pdf"; filename*=UTF-8''W-2%202025.pdf`,
    );
    expect(Buffer.from(await download.arrayBuffer())).toEqual(file);
    await s3.remove(k);
    expect(await s3.head(k)).toBeNull();
    expect(await s3.read(k)).toBeNull();
  });
});
