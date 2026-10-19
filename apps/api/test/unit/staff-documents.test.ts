// Staff documents (R55): confirm's check of the stored bytes per type, and the scan handler
// passing a result to the service as is.
import { describe, expect, it, vi } from 'vitest';
import {
  checkStaffFile,
  type StaffDocumentsService,
} from '../../src/staff/staff-documents.service.js';
import { StaffScanHandler } from '../../src/staff/staff-scan-handler.js';
import type { ScanResultRouter } from '../../src/storage/scan-queue/scan-router.js';

const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const doc = (...names: string[]) =>
  Buffer.concat([CFB, Buffer.alloc(504), ...names.map((n) => Buffer.from(n, 'utf16le'))]);

describe('checkStaffFile', () => {
  it("takes documents' checks for PDF, JPEG and PNG", () => {
    expect(checkStaffFile('application/pdf', Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(checkStaffFile('image/png', Buffer.from('%PDF-1.7\n'))).toBe('UPLOAD_MISMATCH');
    expect(checkStaffFile('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it('wants a Word 97-2003 file to be a compound file without macro storages', () => {
    expect(checkStaffFile('application/msword', doc('WordDocument'))).toBeNull();
    expect(checkStaffFile('application/msword', Buffer.from('%PDF-1.7\n'))).toBe('UPLOAD_MISMATCH');
    expect(checkStaffFile('application/msword', doc('WordDocument', 'Macros'))).toBe(
      'FILE_HAS_MACROS',
    );
    expect(checkStaffFile('application/msword', doc('_VBA_PROJECT'))).toBe('FILE_HAS_MACROS');
  });
});

describe('StaffScanHandler', () => {
  it("hands the result to the service, with the upload id as the key's last part", async () => {
    const recordScan = vi.fn().mockResolvedValue('CLEAN');
    const handler = new StaffScanHandler(
      { register: vi.fn() } as unknown as ScanResultRouter,
      { recordScan } as unknown as StaffDocumentsService,
    );
    const key = 'tenant/b/staff/m/u';
    const outcome = await handler.handle({
      businessId: 'b',
      prefix: 'staff',
      key,
      path: 'm/u',
      status: 'NO_THREATS_FOUND',
      reasons: [],
      versionId: 'v1',
      eventTime: new Date(),
    } as never);
    expect(outcome).toBe('CLEAN');
    expect(recordScan).toHaveBeenCalledWith({
      key,
      status: 'NO_THREATS_FOUND',
      reasons: [],
      versionId: 'v1',
    });
  });
});
