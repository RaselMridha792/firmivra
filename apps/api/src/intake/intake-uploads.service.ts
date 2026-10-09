import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateIntakeUploadRequest,
  INTAKE_LIMITS,
  intakeFields,
  type IntakeView,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { UploadsService } from '../storage/uploads.service.js';
import { readDefinition } from './intake-forms.js';
import { IntakesService, OPEN_STATUSES } from './intakes.service.js';

type UploadBody = z.output<typeof CreateIntakeUploadRequest>;

/** The signed-in client at this firm: who uploads (from the session, never the URL). */
export interface IntakeUploader {
  businessId: string;
  userId: string;
  clientAccountId: string;
  clientId: string;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const locked = () => conflict('INTAKE_LOCKED', 'This form was already sent to the firm');

/**
 * Files in a portal intake's upload slots (R11 step 5). R5's upload steps (ticket, PUT, confirm)
 * with the intake and slot sealed into the ticket; the document gets both on insert (R0's rule),
 * so it counts toward the slot from the start. Only while the intake is open.
 */
@Injectable()
export class IntakeUploadsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly uploads: UploadsService,
    private readonly intakes: IntakesService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** Step 1: 404 for another client's intake; 409 INTAKE_LOCKED or TOO_MANY_FILES. */
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
   * Step 3: the intake must still be open and the slot still have room. Another client's intake
   * is 404 before the token is looked at, as on every route that names one.
   */
  async confirmUpload(
    who: IntakeUploader,
    intakeId: string,
    uploadToken: string,
  ): Promise<IntakeView> {
    await this.inFirm(who.businessId, (tx) => this.ownIntake(tx, who, intakeId));
    await this.uploads.confirm(
      {
        pool: 'CLIENT',
        businessId: who.businessId,
        userId: who.userId,
        clientAccountId: who.clientAccountId,
      },
      uploadToken,
      async (tx, claim) => {
        if (claim.intakeId !== intakeId || !claim.intakeSlot) throw notFound();
        const client = await this.lockClient(tx, who);
        await this.checkSlot(tx, who, intakeId, claim.intakeSlot);
        return client;
      },
    );
    return this.intakes.get(who.businessId, { kind: 'client', clientId: who.clientId }, intakeId);
  }

  /** Takes a file out of its slot while the intake is open; it stays one of the client's documents. */
  async removeUpload(
    who: IntakeUploader,
    intakeId: string,
    documentId: string,
  ): Promise<IntakeView> {
    await this.inFirm(who.businessId, async (tx) => {
      await this.lockIntake(tx, who, intakeId);
      const removed = await tx.document.updateMany({
        where: { businessId: who.businessId, id: documentId, intakeId, clientId: who.clientId },
        data: { intakeId: null, intakeSlot: null },
      });
      if (removed.count === 0) throw notFound();
    });
    await this.audit.log('intake.upload_removed', { type: 'intake', id: intakeId }, { documentId });
    return this.intakes.get(who.businessId, { kind: 'client', clientId: who.clientId }, intakeId);
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

  /** The client's open intake, held for this transaction. */
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
        engagement: { select: { id: true, taxYear: true, service: { select: { kind: true } } } },
      },
    });
    if (!OPEN_STATUSES.includes(intake.status)) throw locked();
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
      throw conflict('TOO_MANY_FILES', 'This upload has its most files: remove one first');
    }
    return { engagementId: engagement.id, taxYear: engagement.taxYear };
  }
}
