import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateIntakeUploadRequest,
  INTAKE_ERRORS,
  INTAKE_LIMITS,
  intakeFields,
  IntakeUpload,
  type OkResponse,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { UploadsService } from '../storage/uploads.service.js';
import { refusal } from '../storage/document-records.js';
import { readDefinition } from './intake-forms.js';
import { requireChangeable, toIntakeUpload, uploadSelect } from './intakes.service.js';

type UploadBody = z.output<typeof CreateIntakeUploadRequest>;

/** The signed-in client at this firm: who uploads (from the session, never the URL). */
export interface IntakeUploader {
  businessId: string;
  userId: string;
  clientAccountId: string;
  clientId: string;
  /** Only the client's PRIMARY login changes an intake (contract B: 403 FORBIDDEN otherwise). */
  primary: boolean;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });

/**
 * Files in a portal intake's upload slots (contract B's createUpload, confirmUpload and
 * removeUpload). R5's upload steps (ticket, PUT, confirm) with the intake and slot sealed into
 * the ticket; the document gets both on insert (R0's rule), so it counts toward the slot from the
 * start. Each step: 404 for another client's intake, 403 FORBIDDEN for a login that isn't the
 * PRIMARY one, 410 INTAKE_EXPIRED, 409 INTAKE_LOCKED, all under the intake row's FOR NO KEY
 * UPDATE lock (the submit takes the same one first).
 */
@Injectable()
export class IntakeUploadsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /**
   * Step 1: then 409 NO_OPEN_SERVICE when the intake's engagement isn't ACTIVE, 400 for a slot
   * that isn't an upload field, 409 TOO_MANY_FILES.
   */
  async createUpload(
    who: IntakeUploader,
    intakeId: string,
    body: UploadBody,
  ): Promise<UploadTicket> {
    const target = await this.inFirm(who.businessId, (tx) =>
      this.checkSlot(tx, who, intakeId, body.slot),
    );
    return this.uploads.ticket({
      pool: 'CLIENT',
      businessId: who.businessId,
      userId: who.userId,
      clientAccountId: who.clientAccountId,
      clientId: who.clientId,
      engagementId: target.engagementId,
      requestId: null,
      categoryId: null,
      direction: 'CLIENT_TO_FIRM',
      taxYear: target.taxYear,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      intakeId,
      intakeSlot: body.slot,
    });
  }

  /**
   * Step 3: the intake must still be open and the slot still have room, checked inside the
   * transaction that adds the file after the intake row's FOR NO KEY UPDATE lock, so confirms at
   * once never pass `maxFiles` or INTAKE_LIMITS.maxFiles. Another client's intake is 404, and a
   * login that isn't the PRIMARY one 403, before the token is looked at. Answers the new file.
   */
  async confirmUpload(
    who: IntakeUploader,
    intakeId: string,
    uploadToken: string,
  ): Promise<IntakeUpload> {
    await this.inFirm(who.businessId, (tx) => this.ownIntake(tx, who, intakeId));
    if (!who.primary) throw forbidden();
    let slot = '';
    const documentId = await this.uploads.confirm(
      {
        pool: 'CLIENT',
        businessId: who.businessId,
        userId: who.userId,
        clientAccountId: who.clientAccountId,
      },
      uploadToken,
      async (tx, claim) => {
        if (claim.intakeId !== intakeId || !claim.intakeSlot) throw notFound();
        slot = claim.intakeSlot;
        const client = await this.lockClient(tx, who);
        await this.checkSlot(tx, who, intakeId, claim.intakeSlot);
        return client;
      },
    );
    const file = await this.database.forBusiness(who.businessId).document.findFirst({
      where: { businessId: who.businessId, id: documentId, clientId: who.clientId },
      select: uploadSelect,
    });
    if (!file) throw notFound();
    // As confirmed: a submit that committed since may have taken it out of a hidden slot.
    return IntakeUpload.parse(toIntakeUpload({ ...file, intakeSlot: file.intakeSlot ?? slot }));
  }

  /**
   * Takes a file out of its slot while the intake is open ("Replace"); it stays one of the
   * client's documents. 404 for a file that isn't in this intake.
   */
  async removeUpload(
    who: IntakeUploader,
    intakeId: string,
    documentId: string,
  ): Promise<OkResponse> {
    await this.inFirm(who.businessId, async (tx) => {
      await this.lockIntake(tx, who, intakeId);
      const removed = await tx.document.updateMany({
        where: { businessId: who.businessId, id: documentId, intakeId, clientId: who.clientId },
        data: { intakeId: null, intakeSlot: null },
      });
      if (removed.count === 0) throw notFound();
    });
    await this.audit.log('intake.upload_removed', { type: 'intake', id: intakeId }, { documentId });
    return { ok: true };
  }

  private async lockClient(tx: TxClient, who: IntakeUploader): Promise<{ archived: boolean }> {
    const [client] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
      SELECT archived_at FROM clients
      WHERE business_id = ${who.businessId}::uuid AND id = ${who.clientId}::uuid
      FOR SHARE`;
    if (!client) throw notFound();
    return { archived: client.archived_at !== null };
  }

  /** 404 unless the intake is one of this client's (any status). */
  private async ownIntake(tx: TxClient, who: IntakeUploader, intakeId: string): Promise<void> {
    const row = await tx.intake.findFirst({
      where: { businessId: who.businessId, id: intakeId, engagement: { clientId: who.clientId } },
      select: { id: true },
    });
    if (!row) throw notFound();
  }

  /**
   * The client's intake, held for this transaction (FOR NO KEY UPDATE, as the submit): 404, then
   * 403 for a login that isn't the PRIMARY one, then 410 INTAKE_EXPIRED or 409 INTAKE_LOCKED.
   */
  private async lockIntake(tx: TxClient, who: IntakeUploader, intakeId: string) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM intakes i
      JOIN engagements e ON e.business_id = i.business_id AND e.id = i.engagement_id
      WHERE i.business_id = ${who.businessId}::uuid AND i.id = ${intakeId}::uuid
        AND e.client_id = ${who.clientId}::uuid
      FOR NO KEY UPDATE OF i`;
    if (!row) throw notFound();
    const intake = await tx.intake.findUniqueOrThrow({
      where: { id: intakeId },
      select: {
        status: true,
        form: { select: { version: true, definition: true } },
        engagement: {
          select: { id: true, status: true, taxYear: true, service: { select: { kind: true } } },
        },
      },
    });
    requireChangeable(intake.status, who);
    return intake;
  }

  /** The slot is an upload field of the intake's form with room for one more file. */
  private async checkSlot(
    tx: TxClient,
    who: IntakeUploader,
    intakeId: string,
    slot: string,
  ): Promise<{ engagementId: string; taxYear: number | null }> {
    const intake = await this.lockIntake(tx, who, intakeId);
    const engagement = intake.engagement!;
    if (engagement.status !== 'ACTIVE') throw refusal('NO_OPEN_SERVICE');
    const definition = readDefinition(intake.form, engagement.service.kind);
    const field = intakeFields(definition).find((f) => f.key === slot);
    if (field?.type !== 'upload') {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Not an upload field' });
    }
    const files = await tx.document.groupBy({
      by: ['intakeSlot'],
      where: { businessId: who.businessId, intakeId },
      _count: { _all: true },
    });
    const inSlot = files.find((f) => f.intakeSlot === slot)?._count._all ?? 0;
    const total = files.reduce((n, f) => n + f._count._all, 0);
    // On confirm the new file is not saved yet, so the limits are the same as on the ticket.
    if (inSlot >= field.maxFiles || total >= INTAKE_LIMITS.maxFiles) {
      throw conflict('TOO_MANY_FILES', INTAKE_ERRORS.TOO_MANY_FILES);
    }
    return { engagementId: engagement.id, taxYear: engagement.taxYear };
  }
}
