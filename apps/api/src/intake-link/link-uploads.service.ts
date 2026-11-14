import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger, type Provider } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateIntakeUploadRequest,
  INTAKE_LIMITS,
  type IntakeUpload,
  intakeFields,
  type UploadTicket,
  UploadContentType,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, poolSecrets, Sealer } from '../auth/sealed.js';
import { intakeUpload } from '../begin-online/begin-online.service.js';
import { draftErrors } from '../begin-online/drafts.js';
import {
  LINK_UPLOAD_ACTIONS,
  leadUploadKey,
  openTickets,
  uploadIdOf,
} from '../begin-online/upload-tickets.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { checkIntakeFileSize } from '../intake/intake-file-size.js';
import { readDefinition } from '../intake/intake-forms.js';
import { requireOpen } from '../intake/intake-step.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import { notFound, refusal, storageUnavailable } from '../storage/document-records.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  type DocumentStorage,
  multipartIdOf,
  S3DocumentStorage,
  uploadTicket,
} from '../storage/document-storage.js';
import { checkFile, type FileRefusal } from '../storage/file-checks.js';
import { readBudget } from '../storage/read-budget.js';
import { MultipartUploadId, uploadTokenSeconds } from '../storage/upload-token.js';
import { REFUSALS_SINCE_MS } from '../storage/uploads.service.js';
import { IntakeLinkService, type LinkFirm, linkFiles, linkInvalid } from './intake-link.service.js';

/** What `createUpload` decided, sealed into the ticket: confirm takes everything from here. */
const LinkUploadClaim = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.uuid(),
  intakeId: z.uuid(),
  leadId: z.uuid(),
  /** The link's token hash: a ticket answers only the link (and so the cookie) that asked. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  slot: z.string(),
  /** tenant/{businessId}/leads/{leadId}/{uuid}, chosen by the API (the leads scan prefix). */
  key: z.string(),
  fileName: z.string(),
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The multipart upload confirm completes; null or absent for a PUT. */
  uploadId: MultipartUploadId.nullable().optional(),
});
type LinkUploadClaim = z.infer<typeof LinkUploadClaim>;

export class LinkUploadTokens extends Sealer<LinkUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-link-upload-v1', LinkUploadClaim, secrets);
  }
}

/** R5's storage and the ticket sealer, provided here as Begin Online does. */
export const LINK_UPLOAD_PROVIDERS: Provider[] = [
  { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
  {
    provide: DOCUMENT_STORAGE,
    inject: [DOCUMENTS_CONFIG],
    useFactory: (config: DocumentsConfig) =>
      new S3DocumentStorage(createS3Client(config), config.bucket),
  },
  {
    provide: LinkUploadTokens,
    inject: [ENV],
    useFactory: (env: Env) => new LinkUploadTokens(poolSecrets(env)),
  },
];

const tooMany = draftErrors.tooManyFiles;
const notAnUpload = () =>
  draftErrors.invalid([
    { step: '', path: ['slot'], label: 'slot', message: 'Not an upload of this form' },
  ]);

/**
 * A lead's files through the secure intake link (Leads item n): Begin Online's three steps with
 * R5's storage and file checks (the firm's size limit from Intake Form Settings, the type and the
 * bytes checked, the leads prefix's malware scan), on lead_uploads rows that name the intake. A
 * ticket for an upload field of the link's form, the browser's PUT, then confirm, which checks the
 * stored file and saves the row. Every step reads the intake from this browser's sealed link cookie
 * (firm, intake and token hash) and checks it is still the intake's live link and open; a ticket
 * is bound to that intake and token. Remove deletes only a file of that same intake (never by id
 * alone), while it is open. Open tickets count toward the caps; a ticket that can no longer be
 * confirmed has its object deleted. The audit holds ids and slot keys, never a file name.
 */
@Injectable()
export class LinkUploadsService {
  private readonly logger = new Logger(LinkUploadsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: LinkUploadTokens,
    private readonly links: IntakeLinkService,
    private readonly portal: PortalInfoService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** POST .../intake-link/uploads: a ticket for an upload field of the link's open form. */
  async ticket(slug: string, req: Request, body: CreateIntakeUploadRequest): Promise<UploadTicket> {
    const { firm, claim } = await this.links.claim(slug, req);
    const businessId = firm.id;
    const row = await this.inFirm(businessId, (tx) => this.links.rowIn(tx, firm, claim));
    requireOpen(row.status);
    const definition = readDefinition(row.form, row.form.service.kind);
    const field = intakeFields(definition).find((f) => f.key === body.slot);
    if (field?.type !== 'upload') throw notAnUpload();
    // The firm's own limit, before storage is asked for anything; confirm checks the sealed size.
    await this.inFirm(businessId, (tx) => checkIntakeFileSize(tx, businessId, body.sizeBytes));
    const leadId = row.leadId!;
    const ticket: LinkUploadClaim = {
      pool: 'CLIENT',
      businessId,
      intakeId: row.id,
      leadId,
      tokenHash: claim.tokenHash,
      slot: body.slot,
      key: leadUploadKey(businessId, leadId, randomUUID()),
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const presigned = await this.s3(() => this.storage.presignUpload(ticket));
    const uploadId = multipartIdOf(presigned);
    const seconds = uploadTokenSeconds(uploadId);
    const uploadToken = await this.tokens.seal({ ...ticket, uploadId }, seconds);
    // Holding the intake (as submit does), the slot's and the form's files and open tickets are
    // counted and this ticket recorded: parallel tickets count one by one.
    await this.inFirm(businessId, async (tx) => {
      await holdIntake(tx, row.id);
      requireOpen((await this.links.rowIn(tx, firm, claim)).status);
      const files = await linkFiles(tx, businessId, row.id);
      const taken = [...files, ...(await openTickets(tx, row.id, LINK_UPLOAD_ACTIONS))];
      const inSlot = taken.filter((f) => f.slot === body.slot).length;
      if (inSlot >= field.maxFiles || taken.length >= INTAKE_LIMITS.maxFiles) throw tooMany();
      await this.audit.logIn(
        tx,
        LINK_UPLOAD_ACTIONS.started,
        { type: 'intake', id: row.id },
        { slot: body.slot, uploadId: uploadIdOf(ticket.key), seconds },
        { businessId },
      );
    });
    return uploadTicket(uploadToken, presigned);
  }

  /** POST .../intake-link/uploads/confirm: checks the stored file and keeps it on the form. */
  async confirm(slug: string, req: Request, uploadToken: string): Promise<IntakeUpload> {
    const ticket = (await this.tokens.open(uploadToken, 'CLIENT'))?.value;
    const session = await this.links
      .claim(slug, req)
      .catch((error: unknown) => this.refuseEnded(slug, ticket, error));
    const { firm, claim } = session;
    if (ticket?.businessId !== firm.id) throw refusal('UPLOAD_EXPIRED');
    if (ticket.intakeId !== claim.intakeId || ticket.tokenHash !== claim.tokenHash) {
      // Another link's ticket: refused, and its object deleted once that link takes no files.
      if (await this.stillOpen(ticket)) throw refusal('UPLOAD_EXPIRED');
      return this.refuse(ticket, refusal('UPLOAD_EXPIRED'));
    }
    const db = this.database.forBusiness(firm.id);
    if (await db.leadUpload.findFirst({ where: { s3Key: ticket.key }, select: { id: true } })) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const refused = await this.checkStored(ticket);
    if (refused) return this.refuse(ticket, refusal(refused));
    try {
      return await this.inFirm(firm.id, async (tx) => {
        await lockKey(tx, ticket.key);
        if (await tx.leadUpload.findFirst({ where: { s3Key: ticket.key } })) {
          throw refusal('UPLOAD_EXPIRED');
        }
        if (await this.refusedBefore(tx, ticket)) throw refusal('UPLOAD_MISMATCH');
        // The intake first (as submit holds it), then count: parallel confirms count one by one.
        await holdIntake(tx, ticket.intakeId);
        const row = await this.links.rowIn(tx, firm, claim);
        requireOpen(row.status);
        const files = await linkFiles(tx, firm.id, row.id);
        const definition = readDefinition(row.form, row.form.service.kind);
        const field = intakeFields(definition).find((f) => f.key === ticket.slot);
        const inSlot = files.filter((f) => f.slot === ticket.slot).length;
        const max = field?.type === 'upload' ? field.maxFiles : 0;
        if (inSlot >= max || files.length >= INTAKE_LIMITS.maxFiles) throw tooMany();
        const created = await tx.leadUpload.create({
          data: {
            businessId: firm.id,
            leadId: ticket.leadId,
            intakeId: ticket.intakeId,
            slot: ticket.slot,
            fileName: ticket.fileName,
            contentType: ticket.contentType,
            sizeBytes: ticket.sizeBytes,
            sha256: ticket.sha256,
            s3Key: ticket.key,
          },
          select: { id: true },
        });
        // A new upload starts PENDING (the database insists); local mode scans it at once.
        const scanned = this.config.scanMode === 'local';
        const saved = await tx.leadUpload.update({
          where: { id: created.id },
          data: scanned ? { scanStatus: 'CLEAN', scannedAt: new Date() } : {},
        });
        await this.audit.logIn(
          tx,
          LINK_UPLOAD_ACTIONS.confirmed,
          { type: 'intake', id: ticket.intakeId },
          { uploadId: uploadIdOf(ticket.key), leadUploadId: created.id, slot: ticket.slot },
          { businessId: firm.id },
        );
        return intakeUpload(saved);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      const code = codeOf(error);
      if (code === 'TOO_MANY_FILES' || code === 'INTAKE_LOCKED' || code === 'LINK_INVALID') {
        return this.refuse(ticket, error as HttpException);
      }
      // The database refused the row: the link or the intake closed while this confirm waited.
      if (isCheckViolation(error)) return this.refuse(ticket, linkInvalid());
      throw error;
    }
  }

  /**
   * DELETE .../intake-link/uploads/{id}: a file of this browser's link intake (the cookie's firm,
   * intake and token hash, checked live), while the intake is open. Any other id is 404.
   */
  async remove(slug: string, req: Request, id: string): Promise<{ ok: true }> {
    const { firm, claim } = await this.links.claim(slug, req);
    const key = await this.inFirm(firm.id, async (tx) => {
      const row = await this.links.rowIn(tx, firm, claim);
      await holdIntake(tx, row.id);
      requireOpen((await this.links.rowIn(tx, firm, claim)).status);
      const file = z.uuid().safeParse(id).success
        ? await tx.leadUpload.findFirst({
            where: { id, businessId: firm.id, intakeId: row.id, leadId: row.leadId! },
            select: { slot: true, s3Key: true },
          })
        : null;
      if (!file) throw notFound();
      await tx.leadUpload.delete({ where: { id } });
      await this.audit.logIn(
        tx,
        'intake_link.upload_deleted',
        { type: 'intake', id: row.id },
        { leadUploadId: id, slot: file.slot },
        { businessId: firm.id },
      );
      return file.s3Key;
    });
    await this.storage.remove(key).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Could not delete the file of lead upload ${id}: ${name}`);
    });
    return { ok: true };
  }

  /** Whether the ticket's own intake still takes files through that ticket's link. */
  private async stillOpen(ticket: LinkUploadClaim): Promise<boolean> {
    const live = await this.inFirm(ticket.businessId, (tx) =>
      tx.intake.findFirst({
        where: {
          id: ticket.intakeId,
          accessTokenHash: ticket.tokenHash,
          accessTokenExpiresAt: { gt: new Date() },
          status: { in: ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'] },
        },
        select: { id: true },
      }),
    );
    return live !== null;
  }

  /**
   * Confirm found no live link for this browser (`error`). A genuine ticket of this firm whose
   * own link takes no more files (closed, replaced or expired) has its object refused and deleted;
   * either way the visitor gets `error`.
   */
  private async refuseEnded(
    slug: string,
    ticket: LinkUploadClaim | undefined,
    error: unknown,
  ): Promise<never> {
    if (!ticket || !(error instanceof HttpException)) throw error;
    const firm: LinkFirm | null = await this.portal.activeFirm(slug).catch(() => null);
    if (ticket.businessId !== firm?.id || (await this.stillOpen(ticket))) throw error;
    return this.refuse(ticket, error);
  }

  /** Why the stored object is not the described file, or null (R5's checks, as Begin Online). */
  private checkStored(ticket: LinkUploadClaim): Promise<FileRefusal | null> {
    return readBudget.hold(ticket.sizeBytes, storageUnavailable, async () => {
      const { uploadId } = ticket;
      if (uploadId) {
        const done = await this.s3(() =>
          this.storage.completeUpload(ticket.key, uploadId, ticket.sizeBytes),
        );
        if (done === 'MISSING') throw refusal('UPLOAD_EXPIRED');
        if (done === 'MISMATCH') return 'UPLOAD_MISMATCH';
      }
      const head = await this.s3(() => this.storage.head(ticket.key));
      if (head?.sizeBytes !== ticket.sizeBytes || head.contentEncoding !== null) {
        return 'UPLOAD_MISMATCH';
      }
      const bytes = await this.s3(() => this.storage.read(ticket.key));
      if (bytes?.byteLength !== ticket.sizeBytes) return 'UPLOAD_MISMATCH';
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== ticket.sha256) return 'UPLOAD_MISMATCH';
      return checkFile(ticket.contentType, bytes);
    });
  }

  /** Whether this key was refused before (the mark `refuse` leaves before it deletes). */
  private async refusedBefore(tx: TxClient, ticket: LinkUploadClaim): Promise<boolean> {
    const row = await tx.auditLog.findFirst({
      where: {
        businessId: ticket.businessId,
        createdAt: { gte: new Date(Date.now() - REFUSALS_SINCE_MS) },
        action: LINK_UPLOAD_ACTIONS.refused,
        entityId: ticket.intakeId,
        metadata: { path: ['uploadId'], equals: uploadIdOf(ticket.key) },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Under the key's lock, unless a row has the key by now (then 410), the refusal is audited and
   * commits; then the object is deleted. A later confirm of the key finds the refusal.
   */
  private async refuse(ticket: LinkUploadClaim, error: HttpException): Promise<never> {
    const saved = await this.inFirm(ticket.businessId, async (tx) => {
      await lockKey(tx, ticket.key);
      if (await tx.leadUpload.findFirst({ where: { s3Key: ticket.key } })) return true;
      await this.audit.logIn(
        tx,
        LINK_UPLOAD_ACTIONS.refused,
        { type: 'intake', id: ticket.intakeId },
        { uploadId: uploadIdOf(ticket.key), code: codeOf(error) },
        { businessId: ticket.businessId },
      );
      return false;
    });
    if (saved) throw refusal('UPLOAD_EXPIRED');
    if (ticket.uploadId) {
      await this.storage.abortUpload(ticket.key, ticket.uploadId).catch(() => {
        this.logger.warn(`Could not drop the refused multipart upload ${uploadIdOf(ticket.key)}`);
      });
    }
    await this.storage.remove(ticket.key).catch(() => {
      this.logger.warn(`Could not delete the refused upload ${uploadIdOf(ticket.key)}`);
    });
    throw error;
  }

  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Storage failed: ${error instanceof Error ? error.name : typeof error}`);
      throw storageUnavailable();
    }
  }
}

/** The intake row, as submit holds it: a confirm, a removal and a submit take turns. */
async function holdIntake(tx: TxClient, intakeId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM intakes WHERE id = ${intakeId}::uuid FOR NO KEY UPDATE`;
}

/** One confirm or refusal of a key at a time, until the transaction ends. */
async function lockKey(tx: TxClient, key: string): Promise<void> {
  const lockName = `lead-upload:${key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' ? (body as { code?: string }).code : undefined;
}

/** A database check (23514) from Prisma: the row's rules refused it. */
function isCheckViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : '';
  return /23514|check_violation|open intake with a live link/.test(text);
}
