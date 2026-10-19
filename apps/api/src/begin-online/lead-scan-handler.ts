import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan, recordScan } from '../storage/scan-record.js';
import type { ScanOutcome } from '../storage/scan-results.service.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The part after tenant/{businessId}/leads/: {leadId}/{uploadId}, as leadUploadKey() names it. */
const PATH = new RegExp(`^(${UUID})/(${UUID})$`);

/**
 * The leads prefix's scan result handler (tenant/{businessId}/leads/{leadId}/{uploadId}): a file
 * uploaded to a Begin Online draft. The result goes on the `lead_uploads` row; a converted lead's
 * upload shares its key with a Document (documents.lead_upload_id), so that row takes the result
 * in the same transaction. A result with no row yet waits for the confirm and is acknowledged
 * after the confirm window (an abandoned draft), never dead-lettered.
 */
@Injectable()
export class LeadScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'leads';
  private readonly logger = new Logger(LeadScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome> {
    const [, leadId, uploadId] = PATH.exec(result.path) ?? [];
    if (!leadId || !uploadId) return 'IGNORED';
    const outcome = await inFirm((tx) =>
      recordScan(tx, this.audit, this.logger, result, {
        table: 'lead_uploads',
        entityType: 'lead_upload',
        metadata: () => ({ leadId }),
        write: async (tx, row, next) => {
          const data = { scanStatus: next.scan, scannedAt: next.scannedAt };
          await tx.leadUpload.update({ where: { id: row.id }, data });
          // The Document a conversion made from this upload (same key); it keeps a result it has.
          await tx.document.updateMany({
            where: { businessId: result.businessId, leadUploadId: row.id, scanStatus: 'PENDING' },
            data,
          });
        },
      }),
    );
    return ignoreOrphan(outcome, result, this.logger, uploadId);
  }
}
