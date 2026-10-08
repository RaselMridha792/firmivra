// R5 steps 2 to 4: the documents settings (SCAN_MODE), the presigned URLs (s3mock does not check
// signatures, so the URLs themselves are checked here), confirm's file checks with generated
// files, and one round trip through s3mock when it runs (docker compose up -d).
import { randomUUID } from 'node:crypto';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDocumentsConfig } from '../../src/storage/config.js';
import {
  attachment,
  createS3Client,
  PUT_URL_SECONDS,
  S3_TIMEOUTS,
  S3DocumentStorage,
} from '../../src/storage/document-storage.js';
import { checkFile } from '../../src/storage/file-checks.js';
import { UPLOAD_TOKEN_SECONDS } from '../../src/storage/upload-token.js';
import { REFUSALS_SINCE_MS } from '../../src/storage/uploads.service.js';
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

  it('allows SCAN_MODE=local in production only for the dev environment (APP_ENV exactly "dev")', () => {
    const local = { ...base, SCAN_MODE: 'local' };
    expect(loadDocumentsConfig({ ...local, NODE_ENV: 'production', APP_ENV: 'dev' }).scanMode).toBe(
      'local',
    );
    expect(
      loadDocumentsConfig({ ...local, NODE_ENV: 'development', APP_ENV: 'prod' }).scanMode,
    ).toBe('local');
    for (const APP_ENV of ['prod', 'staging', '', undefined, 'DEV', ' dev']) {
      expect(
        () => loadDocumentsConfig({ ...local, NODE_ENV: 'production', APP_ENV }),
        String(APP_ENV),
      ).toThrow(/SCAN_MODE=local is only allowed/);
    }
    // Without NODE_ENV, APP_ENV alone allows nothing.
    expect(() => loadDocumentsConfig({ ...local, APP_ENV: 'dev' })).toThrow(/SCAN_MODE/);
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

describe('how long an upload lasts', () => {
  /** The browser's PUT timeout in apps/web/src/lib/upload.ts (PUT_TIMEOUT_MS). */
  const BROWSER_PUT_TIMEOUT_SECONDS = 10 * 60;

  it('the token outlives a slow 10 MB PUT that starts just before its URL expires', () => {
    // A PUT may start at the last second of its URL and run until the browser gives up; the
    // confirm after it must still find a live token (else 410 and an orphaned object).
    expect(UPLOAD_TOKEN_SECONDS).toBeGreaterThanOrEqual(
      PUT_URL_SECONDS + BROWSER_PUT_TIMEOUT_SECONDS,
    );
  });

  it('confirm looks back for refusals longer than a token lives', () => {
    expect(REFUSALS_SINCE_MS).toBeGreaterThan(UPLOAD_TOKEN_SECONDS * 1000);
  });
});

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
    // A Content-Encoding stored by a repeated PUT after the check never reaches the browser.
    expect(url.searchParams.get('response-content-encoding')).toBe('identity');
    expect(url.searchParams.get('response-cache-control')).toBe('private, no-store');
    expect(attachment("it's (1).pdf")).toBe(
      `attachment; filename="it's (1).pdf"; filename*=UTF-8''it%27s%20%281%29.pdf`,
    );
  });
});

describe('the S3 adapter on errors', () => {
  const s3Error = (httpStatusCode: number) =>
    Object.assign(new Error('S3'), { $metadata: { httpStatusCode } });
  const failing = (httpStatusCode: number) =>
    new S3DocumentStorage(
      { send: () => Promise.reject(s3Error(httpStatusCode)) } as unknown as S3Client,
      BUCKET,
    );
  /** A fake S3 that answers each HEAD by its checksum mode, and records what was sent. */
  const heads = (answer: (checksum: boolean) => Promise<unknown>) => {
    const sent: (string | undefined)[] = [];
    const send = (command: HeadObjectCommand) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      sent.push(command.input.ChecksumMode);
      return answer(command.input.ChecksumMode === 'ENABLED');
    };
    return { sent, s3: new S3DocumentStorage({ send } as unknown as S3Client, BUCKET) };
  };

  it('reads 404 as no object, and throws on 403 (a KMS or access failure, never a missing file)', async () => {
    await expect(failing(404).read(key())).resolves.toBeNull();
    await expect(failing(403).read(key())).rejects.toThrow('S3');
    await expect(failing(500).read(key())).rejects.toThrow('S3');
    // HEAD has no s3:ListBucket behind it: 403 is how S3 says there is no such key.
    await expect(failing(403).head(key())).resolves.toBeNull();
    await expect(failing(503).head(key())).rejects.toThrow('S3');
  });

  it("asks for S3's checksum only when told to (downloads), never at confirm", async () => {
    const object = {
      ContentLength: 5,
      ChecksumSHA256: Buffer.from('ab'.repeat(32), 'hex').toString('base64'),
      ContentEncoding: 'gzip',
    };
    const { sent, s3 } = heads(() => Promise.resolve(object));
    expect(await s3.head(key())).toEqual({
      sizeBytes: 5,
      sha256: 'ab'.repeat(32),
      contentEncoding: 'gzip',
    });
    await s3.head(key(), { checksum: true });
    expect(sent).toEqual([undefined, 'ENABLED']);
    const plain = heads(() => Promise.resolve({ ContentLength: 5, ContentEncoding: '' }));
    expect(await plain.s3.head(key())).toMatchObject({ contentEncoding: null });
  });

  it('throws on a 403 with the checksum when the object is there (KMS), else null', async () => {
    // kms:Decrypt missing: the checksum HEAD is 403, a plain HEAD finds the object.
    const kms = heads((checksum) =>
      checksum ? Promise.reject(s3Error(403)) : Promise.resolve({ ContentLength: 5 }),
    );
    await expect(kms.s3.head(key(), { checksum: true })).rejects.toThrow('S3');
    expect(kms.sent).toEqual(['ENABLED', undefined]);
    // No such key: both are 403.
    const gone = heads(() => Promise.reject(s3Error(403)));
    await expect(gone.s3.head(key(), { checksum: true })).resolves.toBeNull();
  });
});

describe('the S3 adapter against storage that never answers', () => {
  let server: Server;
  const sockets = new Set<Socket>();
  let connections = 0;
  let endpoint = '';
  /** What the server does with a new connection (after reading it). */
  let answer: (socket: Socket) => void = () => {};

  beforeAll(async () => {
    server = createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.resume();
      answer(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const timed = async (call: Promise<unknown>) => {
    const started = Date.now();
    const error = await call.then(
      () => null,
      (e: unknown) => e,
    );
    return { error, ms: Date.now() - started };
  };

  it('gives up a HEAD within about 10 to 12 s (2 attempts of 5 s)', async () => {
    answer = () => {}; // never answers
    connections = 0;
    const { error, ms } = await timed(storage(endpoint).head(key()));
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(S3_TIMEOUTS).toMatchObject({ requestTimeout: 5_000, maxAttempts: 2 });
    expect(ms).toBeGreaterThanOrEqual(9_500);
    expect(ms).toBeLessThan(12_500);
    expect(connections).toBe(2);
  }, 20_000);

  it('gives up a GET whose body stops, at its own deadline', async () => {
    // The headers and 10 of 100 bytes, then nothing.
    answer = (socket) => {
      const head =
        'HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: application/pdf\r\n\r\n';
      socket.write(`${head}%PDF-1.4\n%`);
    };
    const s3 = new S3DocumentStorage(
      createS3Client({
        bucket: BUCKET,
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        scanMode: 'local',
      }),
      BUCKET,
      1_000,
    );
    const { error, ms } = await timed(s3.read(key()));
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(3_000);
    expect(S3_TIMEOUTS.readMs).toBe(30_000);
  }, 10_000);
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

  it('finds macro parts by name before reading [Content_Types].xml (a DTD or broken XML too)', () => {
    const vba = { name: 'xl/vbaProject.bin', data: 'x' };
    const dtd = types({ '/xl/workbook.xml': MAIN }, '<!DOCTYPE x [<!ENTITY e "y">]>');
    expect(xlsxWith((p) => [dtd, ...p.slice(1), vba])).toBe('FILE_HAS_MACROS');
    expect(xlsxWith((p) => [{ ...p[0]!, data: '<Types' }, ...p.slice(1), vba])).toBe(
      'FILE_HAS_MACROS',
    );
    expect(xlsxWith((p) => [...p.slice(1), vba])).toBe('FILE_HAS_MACROS');
  });

  it('refuses entry names with NUL or control characters', () => {
    expect(xlsxWith((p) => [...p, { name: 'xl/ok.xml', data: 'x' }])).toBeNull();
    for (const name of ['xl/a\0b.xml', 'xl/a\u0001.xml', 'xl/a\u007f.xml', 'xl/\u0085a.xml']) {
      const flags = name.includes('\u0085') ? 0x800 : 0;
      expect(
        xlsxWith((p) => [...p, { name, data: 'x', flags }]),
        JSON.stringify(name),
      ).toBe('UPLOAD_MISMATCH');
    }
  });

  it('refuses NUL or an encoding other than UTF-8 or UTF-16 in [Content_Types].xml', () => {
    const declared = (encoding: string) =>
      contentTypes({ '/xl/workbook.xml': MAIN }).replace('encoding="UTF-8"', encoding);
    expect(
      xlsxWith((p) => [{ ...p[0]!, data: declared('encoding="utf-8"') }, ...p.slice(1)]),
    ).toBeNull();
    for (const encoding of [
      "encoding='ISO-8859-1'",
      'encoding="UTF-7"',
      'encoding="ebcdic-cp-us"',
    ]) {
      expect(
        xlsxWith((p) => [{ ...p[0]!, data: declared(encoding) }, ...p.slice(1)]),
        encoding,
      ).toBe('UPLOAD_MISMATCH');
    }
    const nul = types({ '/xl/workbook.xml': MAIN }, '<!-- \0 -->');
    expect(xlsxWith((p) => [nul, ...p.slice(1)])).toBe('UPLOAD_MISMATCH');
  });

  it('refuses an end record whose comment does not finish at the end of the file', () => {
    const file = office('xlsx');
    const commented = Buffer.concat([file, Buffer.from('note')]);
    commented.writeUInt16LE(4, file.length - 2);
    expect(checkFile(XLSX, commented)).toBeNull();
    expect(checkFile(XLSX, Buffer.concat([file, Buffer.from('appended')]))).toBe('UPLOAD_MISMATCH');
    const short = Buffer.from(file);
    short.writeUInt16LE(10, file.length - 2); // a comment longer than what follows
    expect(checkFile(XLSX, short)).toBe('UPLOAD_MISMATCH');
  });

  it('refuses a file with no end record, even when its first bytes read as one', () => {
    const file = office('xlsx');
    const end = file.subarray(file.length - 22);
    const headless = Buffer.from(file.subarray(0, file.length - 22));
    expect(headless.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
    // An "end record" at offset -1 would read its fields from the first local header's bytes
    // 9 to 20, which the uploader writes: the entry count, the directory size and offset, and a
    // comment length that reaches the end of the file.
    headless.writeUInt16LE(end.readUInt16LE(10), 9);
    headless.writeUInt32LE(end.readUInt32LE(12), 11);
    headless.writeUInt32LE(end.readUInt32LE(16), 15);
    headless.writeUInt16LE(headless.length - 21, 19);
    expect(checkFile(XLSX, headless)).toBe('UPLOAD_MISMATCH');
    expect(checkFile(XLSX, file.subarray(0, file.length - 22))).toBe('UPLOAD_MISMATCH');
  });

  /** `file` (a ZIP without a comment) with a ZIP64 end record and locator; `edit` changes them. */
  function withZip64(
    file: Buffer,
    edit: (record: Buffer, locator: Buffer, end: Buffer) => void = () => {},
  ): Buffer {
    const at = file.length - 22;
    const end = Buffer.from(file.subarray(at));
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4); // what follows this field
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    const count = BigInt(end.readUInt16LE(10));
    record.writeBigUInt64LE(count, 24);
    record.writeBigUInt64LE(count, 32);
    record.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40);
    record.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(at), 8);
    locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    edit(record, locator, end);
    return Buffer.concat([file.subarray(0, at), record, locator, end]);
  }

  it('reads a ZIP64 end record only when the locator and the end record agree with it', () => {
    const file = office('xlsx');
    const cdSize = file.readUInt32LE(file.length - 22 + 12);
    expect(checkFile(XLSX, withZip64(file))).toBeNull();
    const disagreements: [string, (record: Buffer, locator: Buffer, end: Buffer) => void][] = [
      ['a directory size of its own', (_r, _l, end) => end.writeUInt32LE(cdSize + 1, 12)],
      ['an entry count of its own', (_r, _l, end) => end.writeUInt16LE(5, 10)],
      ['a record that does not end at the locator', (record) => record.writeBigUInt64LE(100n, 4)],
      [
        'a locator pointing past the record',
        (_r, locator) => locator.writeBigUInt64LE(1n << 40n, 8),
      ],
    ];
    for (const [why, edit] of disagreements) {
      expect(checkFile(XLSX, withZip64(file, edit)), why).toBe('UPLOAD_MISMATCH');
    }
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
    // s3mock sends its checksum unasked; S3 only in checksum mode.
    expect(await s3.head(k)).toMatchObject({ sizeBytes: file.length, contentEncoding: null });
    expect(await s3.head(k, { checksum: true })).toEqual({
      sizeBytes: file.length,
      sha256: sha256(file),
      contentEncoding: null,
    });
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
