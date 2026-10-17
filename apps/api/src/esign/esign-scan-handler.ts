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
/**
 * The files Firm Sign scans, under tenant/{businessId}/esign/{requestId}/: a request's uploaded or
 * copied file (`source/{documentId}`, esign_documents) and a signer's attachment
 * (`attachments/{attachmentId}`, esign_attachments). Every other object there is written by the
 * server (the signed PDFs, the certificate, template packets) and has no scan row.
 */
const PATH = new RegExp(`^(${UUID})/(source|attachments)/(${UUID})$`);

/**
 * The esign prefix's scan result handler. A key that is not an uploaded file is server-written and
 * acknowledged (IGNORED). A file's result goes on its row; a copy from the vault is saved CLEAN
 * and keeps that (IGNORED). A result with no row yet waits for the confirm and is acknowledged
 * after the confirm window, never dead-lettered. Audited with ids and codes only.
 */
@Injectable()
export class EsignScanHandler implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'esign';
  private readonly logger = new Logger(EsignScanHandler.name);

  constructor(
    private readonly router: ScanResultRouter,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome> {
    const [, requestId, folder, fileId] = PATH.exec(result.path) ?? [];
    if (!requestId || !folder || !fileId) return 'IGNORED';
    const metadata = () => ({ requestId });
    const outcome = await inFirm((tx) =>
      folder === 'source'
        ? recordScan(tx, this.audit, this.logger, result, {
            table: 'esign_documents',
            entityType: 'esign_document',
            metadata,
            write: async (tx, row, next) => {
              await tx.esignDocument.update({
                where: { id: row.id },
                data: { scanStatus: next.scan, scannedAt: next.scannedAt },
              });
            },
          })
        : recordScan(tx, this.audit, this.logger, result, {
            table: 'esign_attachments',
            entityType: 'esign_attachment',
            metadata,
            write: async (tx, row, next) => {
              await tx.esignAttachment.update({
                where: { id: row.id },
                data: { scanStatus: next.scan, scannedAt: next.scannedAt },
              });
            },
          }),
    );
    return ignoreOrphan(outcome, result, this.logger, fileId);
  }
}
