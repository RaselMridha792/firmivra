// The scan gap (Nov 19): a communication's files carry GuardDuty's verdict, and nothing goes out
// (Send, Schedule, a scheduled start) until every file is CLEAN. The handler records the verdict
// on the file's entry in the firm's own scope, once.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TxClient } from '@firmivra/db';
import {
  attachmentChecks,
  type StoredAttachment,
} from '../../src/communications/communication-attachments.js';
import { CommunicationsScanHandler } from '../../src/communications/communications-scan-handler.js';
import type {
  RoutedScanResult,
  ScanResultRouter,
} from '../../src/storage/scan-queue/scan-router.js';

const firm = randomUUID();
const file = (scanStatus?: StoredAttachment['scanStatus']): StoredAttachment => ({
  id: randomUUID(),
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  sizeBytes: 100,
  s3Key: `tenant/${firm}/communications/${randomUUID()}`,
  ...(scanStatus ? { scanStatus } : {}),
});

describe('attachmentChecks', () => {
  it('lets a communication go only when every file is CLEAN', () => {
    expect(attachmentChecks([])).toEqual([]);
    expect(attachmentChecks([file('CLEAN'), file('CLEAN')])).toEqual([]);
  });

  it('waits for a file still being checked, or attached before the check existed', () => {
    for (const files of [[file('CLEAN'), file('PENDING')], [file()]]) {
      expect(attachmentChecks(files).map((c) => [c.code, c.severity])).toEqual([
        ['ATTACHMENT_SCAN_PENDING', 'BLOCK'],
      ]);
    }
  });

  it('refuses a file that failed or could not finish the check, before any wait', () => {
    for (const bad of ['INFECTED', 'FAILED'] as const) {
      expect(attachmentChecks([file('PENDING'), file(bad)]).map((c) => c.code)).toEqual([
        'ATTACHMENT_BLOCKED',
      ]);
    }
  });
});

describe('CommunicationsScanHandler', () => {
  const setup = (rows: { id: string; attachments: unknown }[]) => {
    const written: unknown[] = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $executeRaw: vi.fn((_s: TemplateStringsArray, json: string) => {
        written.push(JSON.parse(json));
        return Promise.resolve(1);
      }),
    } as unknown as TxClient;
    const audit = { logIn: vi.fn().mockResolvedValue(undefined) };
    const handler = new CommunicationsScanHandler(
      { register: vi.fn() } as unknown as ScanResultRouter,
      audit as never,
    );
    const inFirm = <T>(fn: (t: TxClient) => Promise<T>) => fn(tx);
    return { handler, inFirm, written, audit };
  };
  const result = (key: string, status: RoutedScanResult['status']): RoutedScanResult => ({
    businessId: firm,
    prefix: 'communications',
    key,
    path: key.split('/').slice(3).join('/'),
    status,
    reasons: [],
    versionId: null,
    eventTime: new Date(),
    eventId: randomUUID(),
  });

  it('records the verdict on the file, once, and audits it', async () => {
    const keep = file('CLEAN');
    const pending = file('PENDING');
    const id = randomUUID();
    const { handler, inFirm, written, audit } = setup([{ id, attachments: [keep, pending] }]);
    expect(await handler.handle(result(pending.s3Key, 'NO_THREATS_FOUND'), inFirm)).toBe('CLEAN');
    expect(written).toEqual([[keep, { ...pending, scanStatus: 'CLEAN' }]]);
    expect(audit.logIn).toHaveBeenCalledWith(
      expect.anything(),
      'communication_attachment.scanned',
      { type: 'communication', id },
      expect.objectContaining({ attachmentId: pending.id, scan: 'CLEAN' }),
      { businessId: firm },
    );
  });

  it('marks a threat INFECTED, and leaves a file that already has its verdict', async () => {
    const pending = file();
    const one = setup([{ id: randomUUID(), attachments: [pending] }]);
    expect(await one.handler.handle(result(pending.s3Key, 'THREATS_FOUND'), one.inFirm)).toBe(
      'INFECTED',
    );
    expect(one.written).toEqual([[{ ...pending, scanStatus: 'INFECTED' }]]);
    const done = file('CLEAN');
    const two = setup([{ id: randomUUID(), attachments: [done] }]);
    expect(await two.handler.handle(result(done.s3Key, 'THREATS_FOUND'), two.inFirm)).toBe(
      'IGNORED',
    );
    expect(two.written).toEqual([]);
  });

  it('keeps a result for a file no communication holds yet (UNKNOWN, retried)', async () => {
    const { handler, inFirm, written } = setup([]);
    expect(
      await handler.handle(
        result(`tenant/${firm}/communications/${randomUUID()}`, 'NO_THREATS_FOUND'),
        inFirm,
      ),
    ).toBe('UNKNOWN');
    expect(written).toEqual([]);
  });
});
