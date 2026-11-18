import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import type { ScanOutcome } from '../storage/scan-results.service.js';
import { StaffDraftFilesService } from './staff-draft-files.service.js';

/**
 * SM17: the staff-drafts prefix's scan result handler
 * (tenant/{businessId}/staff-drafts/{draftId}/{uploadId}): StaffDraftFilesService.recordScan, in
 * the key's own firm. A result with no file yet waits for the confirm, as the staff prefix's.
 */
@Injectable()
export class StaffDraftScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'staff-drafts';
  private readonly logger = new Logger(StaffDraftScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly files: StaffDraftFilesService,
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
