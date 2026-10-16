import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from './scan-queue/scan-router.js';
import { type ScanOutcome, ScanResultsService } from './scan-results.service.js';
import { UPLOAD_TOKEN_SECONDS } from './upload-token.js';

/**
 * After this long from GuardDuty's result, an upload with no document will never get one: the
 * PUT happens inside its 15-minute ticket and so does the confirm, plus 5 minutes for a confirm
 * still running. Such a result is an orphan (a closed tab, a confirm that never came).
 */
export const ORPHAN_AFTER_MS = UPLOAD_TOKEN_SECONDS * 1000 + 5 * 60_000;

/**
 * The documents prefix's scan result handler (tenant/{businessId}/documents/{uploadId}):
 * ScanResultsService does the work in the key's own firm scope. A result with no document yet
 * is UNKNOWN (redelivered) inside the confirm window and IGNORED after it, so never-confirmed
 * uploads (and step 7's rescans of them) do not fill the dead-letter queue.
 */
@Injectable()
export class DocumentScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'documents';
  private readonly logger = new Logger(DocumentScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly scans: ScanResultsService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async handle(result: RoutedScanResult): Promise<ScanOutcome> {
    const outcome = await this.scans.recordScanResult({
      key: result.key,
      status: result.status,
      reasons: result.reasons,
      versionId: result.versionId,
    });
    if (outcome !== 'UNKNOWN' || Date.now() - result.eventTime.getTime() <= ORPHAN_AFTER_MS) {
      return outcome;
    }
    const uploadId = result.path.split('/', 1)[0] ?? '';
    this.logger.log(
      `Scan result for upload ${uploadId}: no document after the confirm window, an orphan upload; ignored`,
    );
    return 'IGNORED';
  }
}
