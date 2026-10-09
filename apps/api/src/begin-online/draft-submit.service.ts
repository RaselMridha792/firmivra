import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Database, TxClient } from '@firmivra/db';
import { beginOnlineCookie, type DraftSubmitted } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { lockVersion, prepareSubmit, type SlotFile } from '../intake/intake-submit.js';
import type { IntakeSigning } from '../intake/intakes.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';
import { BeginOnlineService, type Draft } from './begin-online.service.js';
import { draftErrors } from './drafts.js';

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
 * agreements are signed (`sign`) and the version is locked. The lead becomes SUBMITTED and its
 * key is cleared (its draft expiry stays: R0 freezes it). After commit: the removed files' objects
 * are deleted, the cookie is cleared, and the visitor and the firm's owners and admins get an
 * email (service name and a link only).
 */
@Injectable()
export class DraftSubmitService {
  private readonly logger = new Logger(DraftSubmitService.name);
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly drafts: BeginOnlineService,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  async submit(
    slug: string,
    req: Request,
    res: Response,
    sign: IntakeSigning,
  ): Promise<DraftSubmitted> {
    const draft = await this.drafts.draftOf(slug, req);
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
    const context = requestContext.getStore();
    const done = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const lead = await holdLead(tx, draft);
      await tx.$executeRaw`SELECT 1 FROM intakes WHERE id = ${intakeId}::uuid FOR UPDATE`;
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
      await sign(tx, { ...ids, version: current.version });
      const submittedAt = await lockVersion(tx, ids, answers, {
        name: `${lead.first_name} ${lead.last_name}`,
        userId: null,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { status: 'SUBMITTED', submittedAt, resumeTokenHash: null, resumeExpiresAt: null },
      });
      await this.audit.logIn(
        tx,
        'begin_online.submitted',
        { type: 'lead', id: leadId },
        { serviceId: draft.service.id, intakeId, version: current.version, removed: hidden.length },
        { businessId },
      );
      const staff = await tx.membership.findMany({
        where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
        select: { userId: true, user: { select: { email: true } } },
      });
      return { submittedAt, email: lead.email, keys: removed.map((r) => r.s3Key), staff };
    });

    await this.removeObjects(businessId, done.keys);
    const { name, path } = beginOnlineCookie(firm.slug);
    res.clearCookie(name, { httpOnly: true, secure: this.secure, sameSite: 'strict', path });
    await this.emails(draft, done.email, done.staff);
    return {
      leadId,
      service: draft.service,
      submittedAt: done.submittedAt.toISOString(),
    };
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

/** Locks the lead while it is still this live draft with this key, or 404 / 410. */
async function holdLead(tx: TxClient, draft: Draft) {
  const rows = await tx.$queryRaw<{ first_name: string; last_name: string; email: string }[]>`
    SELECT first_name, last_name, email FROM leads
     WHERE id = ${draft.leadId}::uuid AND status = 'DRAFT' AND draft_expires_at > now()
       AND resume_token_hash = ${draft.hash}
       FOR UPDATE`;
  const lead = rows[0];
  if (!lead) throw draftErrors.noDraft();
  return lead;
}
