import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  addEvents,
  addLinks,
  EsignFieldValues,
  inFirm,
  InjectDatabase,
  lockRequest,
  nextActivity,
  queueEmails,
} from '../requests/esign-prisma.js';
import type {
  CompletedFile,
  CompletionInputs,
  CompletionResult,
  CompletionWrite,
  EsignCompletionRepository,
} from './completion.repository.js';

/** The vault category Firm Sign files into (created on first use, kept for good). */
export const SIGNED_CATEGORY = 'Signed Documents';
/** A Firm Sign job's run: its advisory lock is held by a transaction capped at 30 s. */
export const JOB_LIMITS = { timeout: 30_000 } as const;

/**
 * Runs `work` under the job's transaction-scoped advisory lock (one API task at a time); null,
 * running nothing, when another task holds it. The lock's transaction touches no table: it is
 * opened in platform scope, and each firm's work runs in that firm's own scope.
 */
export async function withJobLock<T>(
  database: Database,
  job: string,
  work: () => Promise<T>,
): Promise<T | null> {
  return database.withScope(
    { kind: 'platform' },
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`esign-job:${job}`}, 0)) AS locked`;
      return row?.locked ? work() : null;
    },
    JOB_LIMITS,
  );
}

/** The ACTIVE firms with Firm Sign on (app_firms_with_module: ids only, no firm data). */
export async function esignFirms(database: Database): Promise<string[]> {
  const rows = await database.withScope(
    { kind: 'platform' },
    (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_firms_with_module('esign') AS id`,
  );
  return rows.map((r) => r.id);
}

/**
 * Completion and filing in PostgreSQL (R13, r0_esign). `complete` runs in one transaction in the
 * firm's scope under the request's FOR UPDATE lock: the request COMPLETED with its hashes, then
 * the two CLEAN documents filed in the vault (the scan exception), then their ids on the request,
 * the copy links, the queued emails and the event.
 */
@Injectable()
export class PrismaCompletionRepository implements EsignCompletionRepository {
  constructor(
    @InjectDatabase() private readonly database: Database,
    @Inject(EsignFieldValues) private readonly values: EsignFieldValues,
  ) {}

  withJobLock<T>(work: () => Promise<T>): Promise<T | null> {
    return withJobLock(this.database, 'completion', work);
  }

  firms(): Promise<string[]> {
    return esignFirms(this.database);
  }

  async due(businessId: string, now: Date, limit: number): Promise<string[]> {
    const rows = await this.database.forBusiness(businessId).esignRequest.findMany({
      where: { status: 'PARTIALLY_SIGNED', completionDueAt: { lte: now } },
      orderBy: [{ completionDueAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async inputs(businessId: string, requestId: string): Promise<CompletionInputs> {
    const row = await this.database.forBusiness(businessId).esignRequest.findFirst({
      where: { id: requestId },
      select: {
        fields: {
          where: { recipientId: { not: null }, valueEnc: { not: null } },
          select: { id: true, valueEnc: true },
        },
        recipients: { include: { consentVersion: { select: { version: true } } } },
      },
    });
    if (!row) return { values: [], adoptions: [], consentVersions: [] };
    const values = [];
    for (const f of row.fields) {
      values.push({ fieldId: f.id, value: await this.values.open(businessId, f.id, f.valueEnc!) });
    }
    const mark = (
      method: (typeof row.recipients)[number]['signatureMethod'],
      text: string | null,
      png: Uint8Array | null,
    ) => (method ? { method, text, png } : null);
    return {
      values,
      adoptions: row.recipients.flatMap((r) => {
        const signature = mark(r.signatureMethod, r.signatureText, r.signaturePng);
        if (!signature || !r.printedName) return [];
        const initials = mark(r.initialsMethod, r.initialsText, r.initialsPng);
        return [
          { recipientId: r.id, adoption: { printedName: r.printedName, signature, initials } },
        ];
      }),
      consentVersions: row.recipients.flatMap((r) =>
        r.consentVersion ? [{ recipientId: r.id, version: r.consentVersion.version }] : [],
      ),
    };
  }

  async complete(
    businessId: string,
    id: string,
    write: CompletionWrite,
  ): Promise<CompletionResult | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      const q = locked && (await tx.esignRequest.findUniqueOrThrow({ where: { id } }));
      if (!q || q.status !== 'PARTIALLY_SIGNED' || !q.completionDueAt) return null;
      if (!q.clientId || !q.engagementId) return null;
      const unsigned = await tx.esignRecipient.count({
        where: { requestId: id, kind: 'SIGNER', status: { not: 'SIGNED' } },
      });
      if (unsigned > 0) return null;
      await tx.esignRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: write.completedAt,
          finalSha256: write.final.sha256,
          certificateSha256: write.certificate.sha256,
          completionDueAt: null,
          lastActivityAt: nextActivity(locked.lastActivityAt, write.completedAt),
        },
      });
      const categoryId = await signedCategory(tx, businessId);
      const file = async (f: CompletedFile) => {
        const doc = await tx.document.create({
          data: {
            ...{ businessId, clientId: q.clientId!, engagementId: q.engagementId!, categoryId },
            ...{
              direction: 'FIRM_TO_CLIENT',
              fileName: f.fileName,
              contentType: 'application/pdf',
            },
            ...{ sizeBytes: f.sizeBytes, sha256: f.sha256, s3Key: f.key, esignRequestId: id },
            ...{ scanStatus: 'CLEAN', scannedAt: write.completedAt, legalHold: true },
            retentionUntil: null,
          },
          select: { id: true },
        });
        return doc.id;
      };
      const finalDocumentId = await file(write.final);
      const certificateDocumentId = await file(write.certificate);
      await tx.esignRequest.update({
        where: { id },
        data: { finalDocumentId, certificateDocumentId },
      });
      await addLinks(tx, businessId, id, write.copyLinks, 'COPY');
      await addEvents(tx, businessId, id, [write.event]);
      const emailIds = await queueEmails(tx, businessId, id, write.emails);
      return { finalDocumentId, certificateDocumentId, emailIds };
    });
  }

  async files(businessId: string, requestId: string) {
    const row = await this.database.forBusiness(businessId).esignRequest.findFirst({
      where: { id: requestId, status: 'COMPLETED' },
      select: { finalDocument: { select: FILE }, certificateDocument: { select: FILE } },
    });
    if (!row?.finalDocument || !row.certificateDocument) return null;
    return {
      final: completedFile(row.finalDocument),
      certificate: completedFile(row.certificateDocument),
    };
  }

  async retryLater(businessId: string, requestId: string, retryAt: Date): Promise<void> {
    await this.database.forBusiness(businessId).esignRequest.updateMany({
      where: { id: requestId, status: 'PARTIALLY_SIGNED', completionDueAt: { not: null } },
      data: { completionDueAt: retryAt },
    });
  }
}

const FILE = { s3Key: true, fileName: true, sizeBytes: true, sha256: true } as const;
const completedFile = (d: {
  s3Key: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}) => ({
  key: d.s3Key,
  fileName: d.fileName,
  sizeBytes: d.sizeBytes,
  sha256: d.sha256,
});

/** The firm's 'Signed Documents' category (no retention: kept for good), made on first use. */
async function signedCategory(tx: TxClient, businessId: string): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO document_categories (id, business_id, name, retention_years, updated_at)
    VALUES (gen_random_uuid(), ${businessId}::uuid, ${SIGNED_CATEGORY}, NULL, now())
    ON CONFLICT (business_id, name) DO NOTHING`;
  const row = await tx.documentCategory.findFirstOrThrow({
    where: { businessId, name: SIGNED_CATEGORY },
    select: { id: true },
  });
  return row.id;
}
