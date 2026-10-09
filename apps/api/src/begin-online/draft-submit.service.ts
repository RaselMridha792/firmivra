import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import type { BeginSubmitted, IntakeAnswersInput, IntakeSignatureInput } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { requireFirmWideAgreement } from '../intake/intake-agreement.js';
import { lockVersion, prepareSubmit, type SlotFile } from '../intake/intake-submit.js';
import type { IntakeSigner } from '../intake/intake-signing.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';
import { BeginOnlineService, type Draft, serviceFor } from './begin-online.service.js';
import { holdDraft, rethrowExpired } from './drafts.js';
import { ticketKeys } from './upload-tickets.js';

const changed = () =>
  new ConflictException({
    code: 'INTAKE_CHANGED',
    message: 'Your form changed in another window. Please review it and send it again.',
  });
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);
const filesOf = (draft: Draft): SlotFile[] =>
  draft.uploads.map((u) => ({ id: u.id, slot: u.slot, status: u.scanStatus }));
const sameFiles = (a: SlotFile[], b: SlotFile[]) =>
  JSON.stringify(a.map((f) => [f.id, f.slot, f.status])) ===
  JSON.stringify(b.map((f) => [f.id, f.slot, f.status]));

/**
 * Sends a Begin Online draft (R11 step 3): the whole form is checked before the transaction
 * (`prepareSubmit`); then, holding the lead and its intake, nothing may have changed, the files of
 * hidden slots are deleted while the lead is still a draft (R0: lead files go only then), the
 * agreements are signed (`sign`) and the version is locked (409 NO_INTAKE_AGREEMENT, nothing
 * changed, while the firm has no published firm-wide agreement). The lead becomes SUBMITTED (its
 * draft expiry stays: R0 freezes it); its cookie and resume link stay, so they answer 409
 * DRAFT_SUBMITTED from then on (contract B). After commit: the removed files' objects (and those
 * of tickets never confirmed) are deleted, and the visitor and the firm's owners and admins get an
 * email (service name and a link only).
 */
@Injectable()
export class DraftSubmitService {
  private readonly logger = new Logger(DraftSubmitService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly drafts: BeginOnlineService,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
  ) {}

  async submit(
    slug: string,
    path: string,
    req: Request,
    body: { answers?: IntakeAnswersInput; signature: z.output<typeof IntakeSignatureInput> },
    signer: IntakeSigner,
    source: { ip: string | null; userAgent: string | null },
  ): Promise<BeginSubmitted> {
    if (body.answers) {
      // The review step's answers, saved first as a save of that step (kept if the submit fails).
      const open = await this.drafts.draftOf(slug, path, req);
      const review = open.definition.steps.at(-1)!.key;
      await this.drafts.saveAnswers(open, review, body.answers);
    }
    const draft = await this.drafts.draftOf(slug, path, req);
    const { firm, leadId, intakeId } = draft;
    const businessId = firm.id;
    const before = filesOf(draft);
    const { answers, hidden } = await prepareSubmit(
      this.fe,
      { businessId, intakeId },
      draft.definition,
      draft.submission.answers,
      before,
    );
    const done = await this.database
      .withScope({ kind: 'business', businessId }, async (tx) => {
        // First, before counting or removing files or signing: the intake row, as the portal's
        // submit holds it (R0), then the lead.
        await tx.$queryRaw`SELECT 1 FROM intakes WHERE id = ${intakeId}::uuid FOR NO KEY UPDATE`;
        const lead = await holdDraft(tx, leadId);
        const current = await tx.intakeSubmission.findFirst({
          where: { intakeId, submittedAt: null },
          select: { id: true, version: true, answers: true },
        });
        const files = await tx.leadUpload.findMany({
          where: { leadId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, slot: true, scanStatus: true },
        });
        const now = files.map((f) => ({ id: f.id, slot: f.slot, status: f.scanStatus }));
        if (
          current?.id !== draft.submission.id ||
          JSON.stringify(current.answers) !== JSON.stringify(draft.submission.answers) ||
          !sameFiles(now, before)
        ) {
          throw changed();
        }
        // Nothing to sign: 409 NO_INTAKE_AGREEMENT before any file or version changes.
        await requireFirmWideAgreement(tx, businessId);
        // The agreements signed are those of the block the review step showed: R14's
        // `beginOnlineService` resolves the service, as the block does.
        const service = await serviceFor(tx, draft.form);
        const removed = hidden.length
          ? await tx.leadUpload.findMany({
              where: { id: { in: hidden.map((f) => f.id) } },
              select: { s3Key: true },
            })
          : [];
        if (hidden.length) {
          await tx.leadUpload.deleteMany({ where: { id: { in: hidden.map((f) => f.id) } } });
        }
        const ids = { businessId, intakeId, submissionId: current.id };
        // Answers first, then the signature (R14 freezes them), then the version submitted.
        // R14's sign(): the lead's Terms and Privacy acceptance is required when the firm has
        // published both (400 VALIDATION_FAILED without it, 409 TERMS_OUTDATED for old versions).
        await lockVersion(tx, ids, answers, null, () =>
          signer.sign(tx, {
            ...ids,
            serviceId: service.id,
            signer: { kind: 'lead', leadId, email: lead.email },
            signature: body.signature,
            ...source,
          }),
        );
        const { submittedAt } = await tx.intakeSubmission.findUniqueOrThrow({
          where: { id: current.id },
          select: { submittedAt: true },
        });
        if (!submittedAt) throw new Error('The version was not submitted');
        await tx.lead.update({
          where: { id: leadId },
          data: { status: 'SUBMITTED', submittedAt },
        });
        await this.audit.logIn(
          tx,
          'begin_online.submitted',
          { type: 'lead', id: leadId },
          {
            serviceId: draft.service.id,
            intakeId,
            version: current.version,
            removed: hidden.length,
          },
          { businessId },
        );
        const staff = await tx.membership.findMany({
          where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
          select: { userId: true, user: { select: { email: true } } },
        });
        // The removed files' objects, and those of tickets never confirmed: each is deleted
        // after commit unless a row holds its key (the files the lead keeps).
        const { createdAt } = await tx.lead.findUniqueOrThrow({
          where: { id: leadId },
          select: { createdAt: true },
        });
        const tickets = await ticketKeys(tx, businessId, leadId, createdAt);
        const keys = [...new Set([...removed.map((r) => r.s3Key), ...tickets])];
        return { submittedAt, email: lead.email, keys, staff };
      })
      .catch(rethrowExpired);

    await this.removeObjects(businessId, done.keys);
    await this.emails(draft, done.email, done.staff);
    return { received: true, form: draft.form, submittedAt: done.submittedAt.toISOString() };
  }

  /** The removed files' objects, each only while no row has its key. */
  private async removeObjects(businessId: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      const kept = await this.database
        .forBusiness(businessId)
        .leadUpload.findFirst({ where: { s3Key: key }, select: { id: true } });
      if (kept) continue;
      await this.storage.remove(key).catch((error: unknown) => {
        this.logger.warn(`Could not delete a removed lead upload's file: ${nameOf(error)}`);
      });
    }
  }

  /** A failed email never fails the submit: the lead is in the firm's list either way. */
  private async emails(
    draft: Draft,
    email: string,
    staff: { userId: string; user: { email: string } }[],
  ): Promise<void> {
    const businessId = draft.firm.id;
    const serviceName = draft.service.name;
    const link = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/leads/${draft.leadId}`;
    const sends = [
      this.notify.send({
        template: 'lead.confirmation',
        to: email,
        businessId,
        data: { serviceName },
      }),
      ...staff.map((m) =>
        this.notify.send({
          template: 'lead.received',
          to: m.user.email,
          businessId,
          recipient: { userId: m.userId },
          data: { serviceName, link },
        }),
      ),
    ];
    const results = await Promise.allSettled(sends);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(`Lead ${draft.leadId}: an email was not sent: ${nameOf(r.reason)}`);
      }
    }
  }
}
