import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import type { ScanOutcome } from '../storage/scan-results.service.js';
import { AgreementFilesService } from './agreement-files.service.js';

/**
 * The agreements prefix's scan result handler (tenant/{businessId}/agreements/{uploadId}): the
 * work is AgreementFilesService.recordScan's (the file found by its key in the key's own firm,
 * audited with ids and codes only). A result with no file yet waits for the confirm and is
 * acknowledged after the confirm window (an upload the firm never confirmed), never
 * dead-lettered.
 */
@Injectable()
export class AgreementScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'agreements';
  private readonly logger = new Logger(AgreementScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly files: AgreementFilesService,
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
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/', 1)[0] ?? '');
  }
}
