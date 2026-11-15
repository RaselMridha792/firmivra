import { BadRequestException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { documentFileSizeProblem } from '@firmivra/types';

/** A firm with no Documents settings row yet: the table's default (document_settings DEFAULT 100). */
const DEFAULT_MB = 100;

/** DOCUMENTS-LIMIT-01: the firm's largest regular document, in MB, for the screens to check. */
export async function documentFileSizeMb(tx: TxClient, businessId: string): Promise<number> {
  const row = await tx.documentSettings.findUnique({
    where: { businessId },
    select: { maxFileSizeMb: true },
  });
  return row?.maxFileSizeMb ?? DEFAULT_MB;
}

/**
 * DOCUMENTS-LIMIT-01 (Intake Forms Review Two): refuses a regular document over the firm's limit
 * (Documents > Settings > File Settings, 5 to 100 MB) at the upload ticket, before anything goes
 * to storage: 400 VALIDATION_FAILED at `sizeBytes` naming the limit ("Files can be at most 20 MB").
 * Staff uploads (the library and a client's documents) and the client portal's call it; intake
 * forms keep their own limit (checkIntakeFileSize). The platform's 100 MB is the contract's own
 * check, first. A ticket already given keeps its sealed size if the limit is lowered after.
 */
export async function checkDocumentFileSize(
  tx: TxClient,
  businessId: string,
  sizeBytes: number,
): Promise<void> {
  const problem = documentFileSizeProblem(sizeBytes, await documentFileSizeMb(tx, businessId));
  if (problem) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path: 'sizeBytes', message: problem }],
    });
  }
}
