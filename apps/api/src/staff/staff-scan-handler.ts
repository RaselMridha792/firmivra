import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import type { ScanOutcome } from '../storage/scan-results.service.js';
import { StaffDocumentsService } from './staff-documents.service.js';

/**
 * The staff prefix's scan result handler (tenant/{businessId}/staff/{membershipId}/{uploadId}):
 * the work is StaffDocumentsService.recordScan's, in the key's own firm with no actor (the
 * scanner's place in the documents wall). A result with no file yet waits for the confirm and is
 * acknowledged after the confirm window, never dead-lettered.
 */
@Injectable()
export class StaffScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'staff';
  private readonly logger = new Logger(StaffScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly files: StaffDocumentsService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async handle(result: RoutedScanResult): Promise<ScanOutcome> {
    const outcome = await this.files.recordScan({
      key: result.key,
      status: result.status,
      reasons: result.reasons,
      versionId: result.versionId,
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }
}
