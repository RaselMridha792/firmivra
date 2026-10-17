// R55: the scan result handlers of the leads, esign and agreements prefixes (the documents handler
// is covered in scan-queue.e2e.test.ts). A fake transaction records what each handler reads and
// writes; the audit service is a spy. The point of each case: the outcome the consumer acts on
// (a clean file is acknowledged, an infected one is recorded like a document, a key whose record
// is gone is acknowledged and logged, never left for the dead-letter queue), the row found by its
// key in the key's firm only, and ids and codes only in the audit row and the log.
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { TxClient } from '@firmivra/db';
import type { AuditService } from '../../src/audit/audit.service.js';
import { AgreementScanHandler } from '../../src/agreements/agreement-scan-handler.js';
import type { AgreementFilesService } from '../../src/agreements/agreement-files.service.js';
import { LeadScanHandler } from '../../src/begin-online/lead-scan-handler.js';
import { EsignScanHandler } from '../../src/esign/esign-scan-handler.js';
import { ORPHAN_AFTER_MS } from '../../src/storage/document-scan-handler.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanPrefix,
  type ScanResultHandler,
  type ScanResultRouter,
} from '../../src/storage/scan-queue/scan-router.js';
import type { ScanOutcome } from '../../src/storage/scan-results.service.js';

const biz = randomUUID();
const leadId = randomUUID();
const requestId = randomUUID();
const fileId = randomUUID();

type Status = RoutedScanResult['status'];
function result(
  prefix: ScanPrefix,
  path: string,
  status: Status = 'NO_THREATS_FOUND',
  over: Partial<RoutedScanResult> = {},
): RoutedScanResult {
  return {
    businessId: biz,
    prefix,
    key: `tenant/${biz}/${prefix}/${path}`,
    path,
    status,
    reasons: [],
    versionId: null,
    eventTime: new Date(),
    eventId: randomUUID(),
    ...over,
  };
}

interface Row {
  id: string;
  scan_status: string;
  content_type: string;
}

/** A transaction with one row to find (or none) and spies on every write. */
function fakeTx(row?: Row) {
  const tx = {
    $queryRawUnsafe: vi.fn(() => Promise.resolve(row ? [row] : [])),
    leadUpload: { update: vi.fn(() => Promise.resolve({})) },
    document: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    esignDocument: { update: vi.fn(() => Promise.resolve({})) },
    esignAttachment: { update: vi.fn(() => Promise.resolve({})) },
  };
  const inFirm: InFirm = (fn) => fn(tx as unknown as TxClient);
  return { tx, inFirm };
}

const pending = (contentType = 'application/pdf'): Row => ({
  id: randomUUID(),
  scan_status: 'PENDING',
  content_type: contentType,
});

let audit: { logIn: MockInstance };
let router: { register: MockInstance };
let log: MockInstance;
let warn: MockInstance;

beforeEach(() => {
  audit = { logIn: vi.fn(() => Promise.resolve()) };
  router = { register: vi.fn() };
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const asRouter = () => router as unknown as ScanResultRouter;
const asAudit = () => audit as unknown as AuditService;
const leads = () => new LeadScanHandler(asRouter(), asAudit());
const esign = () => new EsignScanHandler(asRouter(), asAudit());

const leadPath = `${leadId}/${fileId}`;
const sourcePath = `${requestId}/source/${fileId}`;
const attachmentPath = `${requestId}/attachments/${fileId}`;

/** What the audit row and the logs may hold: ids and codes, never a name, bytes or a threat. */
function expectNothingPersonal() {
  const text = JSON.stringify([audit.logIn.mock.calls, log.mock.calls, warn.mock.calls]);
  expect(text).not.toMatch(/fake-name|\.pdf|eicar/i);
}

describe('registration', () => {
  it.each([
    ['leads', () => leads()],
    ['esign', () => esign()],
    ['agreements', () => new AgreementScanHandler(asRouter(), {} as AgreementFilesService)],
  ] as const)('%s registers itself with the router on start', (prefix, make) => {
    const handler = make();
    expect(handler.prefix).toBe(prefix);
    handler.onModuleInit();
    expect(router.register).toHaveBeenCalledWith(handler);
  });
});

/** The cases the two table-backed handlers share; each gets its path, writes and audit name. */
const tableHandlers: {
  name: string;
  make: () => ScanResultHandler;
  prefix: ScanPrefix;
  path: string;
  entity: string;
  wrote: (tx: ReturnType<typeof fakeTx>['tx']) => MockInstance;
}[] = [
  {
    name: 'leads',
    make: leads,
    prefix: 'leads',
    path: leadPath,
    entity: 'lead_upload',
    wrote: (tx) => tx.leadUpload.update,
  },
  {
    name: 'esign request file',
    make: esign,
    prefix: 'esign',
    path: sourcePath,
    entity: 'esign_document',
    wrote: (tx) => tx.esignDocument.update,
  },
  {
    name: 'esign signer attachment',
    make: esign,
    prefix: 'esign',
    path: attachmentPath,
    entity: 'esign_attachment',
    wrote: (tx) => tx.esignAttachment.update,
  },
];

describe.each(tableHandlers)('$name', ({ make, prefix, path, entity, wrote }) => {
  const handle = (
    row: Row | undefined,
    status: Status = 'NO_THREATS_FOUND',
    over: Partial<RoutedScanResult> = {},
  ) => {
    const { tx, inFirm } = fakeTx(row);
    return make()
      .handle(result(prefix, path, status, over), inFirm)
      .then((outcome) => ({ outcome, tx }));
  };

  it('looks the row up by its key in the key’s firm only', async () => {
    const { tx } = await handle(pending());
    const [sql, business, key] = tx.$queryRawUnsafe.mock.calls[0] as unknown as string[];
    expect(sql).toMatch(/WHERE business_id = \$1::uuid AND s3_key = \$2 FOR UPDATE/);
    expect([business, key]).toEqual([biz, `tenant/${biz}/${prefix}/${path}`]);
  });

  it('records a clean file and audits ids and codes', async () => {
    const row = pending();
    const { outcome, tx } = await handle(row);
    expect(outcome).toBe('CLEAN');
    expect(wrote(tx)).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { scanStatus: 'CLEAN', scannedAt: expect.any(Date) as Date },
    });
    const [, action, target, metadata, at] = audit.logIn.mock.calls[0] as unknown[];
    expect([action, target, at]).toEqual([
      `${entity}.scanned`,
      { type: entity, id: row.id },
      { businessId: biz },
    ]);
    expect(metadata).toMatchObject({ scanStatus: 'CLEAN', result: 'NO_THREATS_FOUND' });
    expectNothingPersonal();
  });

  it('records an infected file as documents do', async () => {
    const row = pending();
    const { outcome, tx } = await handle(row, 'THREATS_FOUND');
    expect(outcome).toBe('INFECTED');
    expect(wrote(tx)).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { scanStatus: 'INFECTED', scannedAt: expect.any(Date) as Date },
    });
    expect(audit.logIn.mock.calls[0]?.[1]).toBe(`${entity}.scanned`);
    expectNothingPersonal();
  });

  it('records FAILED for a file the scan can’t read, and a password-protected PDF as unscanned', async () => {
    const failed = await handle(pending(), 'UNSUPPORTED', {
      reasons: ['OBJECT_SIZE_LIMIT_EXCEEDED'],
    });
    expect(failed.outcome).toBe('FAILED');
    audit.logIn.mockClear();
    const locked = await handle(pending('application/pdf'), 'UNSUPPORTED', {
      reasons: ['PASSWORD_PROTECTED'],
    });
    expect(locked.outcome).toBe('UNSCANNED');
    expect(wrote(locked.tx)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'CLEAN' }) as object }),
    );
    expect(audit.logIn.mock.calls[0]?.[3]).toMatchObject({ unscanned: true });
  });

  it('leaves the file PENDING when the scan broke on our side, and audits it', async () => {
    const { outcome, tx } = await handle(pending(), 'FAILED');
    expect(outcome).toBe('PENDING');
    expect(wrote(tx)).not.toHaveBeenCalled();
    expect(audit.logIn.mock.calls[0]?.[1]).toBe(`${entity}.scan_unfinished`);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores a result for a file that already has one', async () => {
    const { outcome, tx } = await handle({ ...pending(), scan_status: 'CLEAN' });
    expect(outcome).toBe('IGNORED');
    expect(wrote(tx)).not.toHaveBeenCalled();
    expect(audit.logIn).not.toHaveBeenCalled();
  });

  it('waits for the confirm when the row is not there yet (the message is kept)', async () => {
    const { outcome, tx } = await handle(undefined);
    expect(outcome).toBe('UNKNOWN');
    expect(wrote(tx)).not.toHaveBeenCalled();
  });

  it('acknowledges and logs a result whose row never came, never dead-lettering it', async () => {
    const eventTime = new Date(Date.now() - ORPHAN_AFTER_MS - 60_000);
    const { outcome } = await handle(undefined, 'NO_THREATS_FOUND', { eventTime });
    expect(outcome).toBe('IGNORED');
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`upload ${fileId}`));
    expectNothingPersonal();
    // The log names the kind and the id, not the firm, key or path.
    expect(log.mock.calls.flat().join(' ')).not.toContain(biz);
  });
});

describe('leads', () => {
  it('gives the converted lead’s document the same result, only while it is still PENDING', async () => {
    const row = pending();
    const { tx, inFirm } = fakeTx(row);
    await leads().handle(result('leads', leadPath, 'THREATS_FOUND'), inFirm);
    expect(tx.document.updateMany).toHaveBeenCalledWith({
      where: { businessId: biz, leadUploadId: row.id, scanStatus: 'PENDING' },
      data: { scanStatus: 'INFECTED', scannedAt: expect.any(Date) as Date },
    });
  });

  it('puts the lead id in the audit row and ignores a key that is not a lead upload', async () => {
    const row = pending();
    const { inFirm } = fakeTx(row);
    await leads().handle(result('leads', leadPath), inFirm);
    expect(audit.logIn.mock.calls[0]?.[3]).toMatchObject({ leadId });
    const other = fakeTx(row);
    for (const path of [fileId, `${leadId}/${fileId}/extra`, `${leadId}/not-a-uuid`]) {
      expect(await leads().handle(result('leads', path), other.inFirm)).toBe('IGNORED');
    }
    expect(other.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('esign', () => {
  it('puts the request id in the audit row', async () => {
    const { inFirm } = fakeTx(pending());
    await esign().handle(result('esign', sourcePath), inFirm);
    expect(audit.logIn.mock.calls[0]?.[3]).toMatchObject({ requestId });
  });

  it('acknowledges the objects the server writes, with no database access', async () => {
    const { tx, inFirm } = fakeTx(pending());
    for (const path of [
      `${requestId}/completed/${'a'.repeat(64)}.pdf`,
      `${requestId}/source/not-a-uuid`,
      `${requestId}/attachments`,
      `${leadId}/template-${'b'.repeat(64)}.pdf`,
      requestId,
    ]) {
      expect(await esign().handle(result('esign', path), inFirm)).toBe('IGNORED');
    }
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(audit.logIn).not.toHaveBeenCalled();
  });
});

describe('agreements', () => {
  const key = `tenant/${biz}/agreements/${fileId}`;
  function handler(outcome: ScanOutcome) {
    const recordScan = vi.fn(() => Promise.resolve(outcome));
    const files = { recordScan } as unknown as AgreementFilesService;
    return { recordScan, handler: new AgreementScanHandler(asRouter(), files) };
  }

  it('hands the result to the agreement files service and returns its outcome', async () => {
    for (const outcome of ['CLEAN', 'INFECTED', 'FAILED', 'PENDING', 'IGNORED'] as const) {
      const h = handler(outcome);
      const r = result('agreements', fileId, 'THREATS_FOUND', { reasons: ['X'], versionId: 'v1' });
      expect(await h.handler.handle(r)).toBe(outcome);
      expect(h.recordScan).toHaveBeenCalledWith({
        key,
        status: 'THREATS_FOUND',
        reasons: ['X'],
        versionId: 'v1',
      });
    }
  });

  it('keeps an unconfirmed upload’s result inside the confirm window, drops it after', async () => {
    const h = handler('UNKNOWN');
    expect(await h.handler.handle(result('agreements', fileId))).toBe('UNKNOWN');
    const late = result('agreements', fileId, 'NO_THREATS_FOUND', {
      eventTime: new Date(Date.now() - ORPHAN_AFTER_MS - 60_000),
    });
    expect(await h.handler.handle(late)).toBe('IGNORED');
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`upload ${fileId}`));
    expect(log.mock.calls.flat().join(' ')).not.toContain(biz);
  });
});
