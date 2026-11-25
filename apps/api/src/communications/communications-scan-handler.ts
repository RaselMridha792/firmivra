import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import { type ScanOutcome, scanVerdict } from '../storage/scan-results.service.js';
import { scanOf, storedAttachments } from './communication-attachments.js';

/**
 * The scan gap (Nov 19): GuardDuty's verdict for a communication's file
 * (tenant/{businessId}/communications/{uuid}), recorded on its entry in `communications.attachments`
 * in the key's own firm, once, while it is PENDING. Send and Schedule wait for CLEAN
 * (communication-attachments.ts). A result for a file no communication holds (removed, or the
 * confirm not in yet) is UNKNOWN, and the router keeps it for a retry until it is an orphan.
 */
@Injectable()
export class CommunicationsScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'communications';
  private readonly logger = new Logger(CommunicationsScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome> {
    const outcome = await inFirm(async (tx): Promise<ScanOutcome> => {
      // Each key belongs to one communication of the firm (a random key per upload).
      const rows = await tx.$queryRaw<{ id: string; attachments: unknown }[]>`
        SELECT id, attachments FROM communications
        WHERE business_id = ${result.businessId}::uuid
          AND attachments @> ${JSON.stringify([{ s3Key: result.key }])}::jsonb
        LIMIT 1
        FOR UPDATE`;
      const row = rows[0];
      if (!row) return 'UNKNOWN';
      const list = storedAttachments(row.attachments);
      const file = list.find((a) => a.s3Key === result.key);
      if (!file) return 'UNKNOWN';
      if (scanOf(file) !== 'PENDING') return 'IGNORED';
      const verdict = scanVerdict(
        { key: result.key, status: result.status, reasons: [...result.reasons] },
        file.contentType,
      );
      if (!verdict) {
        this.logger.warn(`Scan of communication file ${file.id} did not finish: ${result.status}`);
        return 'PENDING';
      }
      const next = list.map((a) => (a.id === file.id ? { ...a, scanStatus: verdict.scan } : a));
      // As the composer's own writes: the files change, the row's save time does not.
      await tx.$executeRaw`UPDATE communications SET attachments = ${JSON.stringify(next)}::jsonb
        WHERE business_id = ${result.businessId}::uuid AND id = ${row.id}::uuid`;
      await this.audit.logIn(
        tx,
        'communication_attachment.scanned',
        { type: 'communication', id: row.id },
        {
          communicationId: row.id,
          attachmentId: file.id,
          scan: verdict.scan,
          unscanned: verdict.unscanned,
        },
        { businessId: result.businessId },
      );
      return verdict.unscanned
        ? 'UNSCANNED'
        : verdict.scan === 'CLEAN'
          ? 'CLEAN'
          : verdict.scan === 'INFECTED'
            ? 'INFECTED'
            : 'FAILED';
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }
}
