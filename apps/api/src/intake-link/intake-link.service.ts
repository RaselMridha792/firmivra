import {
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  COUNTED_UPLOAD_STATUSES,
  INTAKE_LINK_ERRORS,
  type IntakeAgreementBlock,
  type IntakeAnswersInput,
  IntakeFormKey,
  type IntakeSignatureInput,
  LinkIntake,
  type SavedIntakeStep,
} from '@firmivra/types';
import type { z } from 'zod';
import { AgreementsService } from '../agreements/agreements.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { intakeUpload, LEAD_FILE_FIELDS } from '../begin-online/begin-online.service.js';
import { hashToken } from '../begin-online/drafts.js';
import { ticketKeys } from '../begin-online/upload-tickets.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';
import { requireFirmWideAgreement } from '../intake/intake-agreement.js';
import { intakeFileSizeMb } from '../intake/intake-file-size.js';
import { readDefinition } from '../intake/intake-forms.js';
import { maskStoredNumbers } from '../intake/intake-numbers.js';
import type { IntakeSigner } from '../intake/intake-signing.js';
import { intakeLocked, OPEN_STATUSES, requireOpen, saveIntakeStep } from '../intake/intake-step.js';
import { lockVersion, prepareSubmit, type SlotFile } from '../intake/intake-submit.js';
import { sendSubmittedNotice } from '../intake-workspace/submitted-notice.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { IntakeLinkCookies, type LinkClaim } from './intake-link-cookies.js';

export const linkInvalid = () =>
  new GoneException({ code: 'LINK_INVALID', message: INTAKE_LINK_ERRORS.LINK_INVALID });
const CHANGED = 'INTAKE_CHANGED';
const changed = () =>
  new ConflictException({
    code: CHANGED,
    message: 'Your form changed in another window. Please review it and send it again.',
  });
/** How often a submit starts again when a save landed while it checked the form. */
const SUBMIT_ATTEMPTS = 3;
const answersOf = (v: unknown) => (v ?? {}) as Record<string, unknown>;
const iso = (d: Date) => d.toISOString();

const linkSelect = {
  id: true,
  leadId: true,
  status: true,
  dueOn: true,
  correctionNote: true,
  correctionRequestedAt: true,
  accessTokenExpiresAt: true,
  sentAt: true,
  form: {
    select: {
      version: true,
      title: true,
      definition: true,
      serviceId: true,
      service: { select: { kind: true } },
    },
  },
  lead: { select: { firstName: true, email: true, taxYear: true } },
  submissions: {
    orderBy: { version: 'desc' },
    take: 2,
    select: {
      id: true,
      version: true,
      answers: true,
      savedSteps: true,
      submittedAt: true,
      signerName: true,
      signedAt: true,
    },
  },
} satisfies Prisma.IntakeSelect;
export type LinkRow = Prisma.IntakeGetPayload<{ select: typeof linkSelect }>;
export type LinkFirm = { id: string; slug: string };
type Firm = LinkFirm;

/** The lead's files through this intake's link (item n), oldest first. */
export const linkFiles = (tx: TxClient, businessId: string, intakeId: string) =>
  tx.leadUpload.findMany({
    where: { businessId, intakeId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: LEAD_FILE_FIELDS,
  });

/**
 * A lead's secure intake link (Intake Forms Review Two, INTAKE-ACCESS-01; contract:
 * packages/types/src/intake/link.ts). The firm emails the lead `{PORTAL_BASE_URL}/{slug}/form
 * #token=...` (IntakeSendService); only the token's SHA-256 is kept, with its expiry, on the
 * intake. The page posts the token once for a sealed HttpOnly cookie (IntakeLinkCookies: firm,
 * intake and token hash), and every other route reads the intake from that cookie, checked again
 * against the intake each time: a link that is unknown, replaced (a resend or a reminder), past its
 * expiry, or on a form that was archived or expired answers 410 LINK_INVALID, the same answer for
 * each. The lead fills, saves and signs the one form, and adds files to its upload fields
 * (LinkUploadsService, Leads item n: lead_uploads rows naming this intake).
 * Audit rows hold ids and step keys only: never answers, names, emails or tokens.
 */
@Injectable()
export class IntakeLinkService {
  private readonly logger = new Logger(IntakeLinkService.name);
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly portal: PortalInfoService,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    private readonly agreementsService: AgreementsService,
    private readonly cookies: IntakeLinkCookies,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The lead's intake behind a live link: by the token's hash (and, from a cookie, its id). */
  private async find(
    tx: TxClient,
    businessId: string,
    where: { tokenHash: string; intakeId?: string },
  ): Promise<LinkRow> {
    const row = await tx.intake.findFirst({
      where: {
        businessId,
        ...(where.intakeId ? { id: where.intakeId } : {}),
        accessTokenHash: where.tokenHash,
        accessTokenExpiresAt: { gt: new Date() },
        leadId: { not: null },
        status: { notIn: ['DRAFT', 'ARCHIVED', 'EXPIRED'] },
        lead: { archivedAt: null },
      },
      select: linkSelect,
    });
    if (!row?.lead || !row.accessTokenExpiresAt) throw linkInvalid();
    return row;
  }

  /** The live intake behind this browser's cookie, read in the caller's transaction. */
  rowIn(tx: TxClient, firm: Firm, claim: LinkClaim): Promise<LinkRow> {
    return this.find(tx, firm.id, { tokenHash: claim.tokenHash, intakeId: claim.intakeId });
  }

  /** This browser's link at the firm, from its cookie; 410 LINK_INVALID without a live one. */
  async claim(slug: string, req: Request): Promise<{ firm: Firm; claim: LinkClaim }> {
    const firm = await this.portal.activeFirm(slug);
    const claim = await this.cookies.read(req, firm);
    if (!claim) throw linkInvalid();
    return { firm, claim };
  }

  private current(firm: Firm, claim: LinkClaim): Promise<LinkRow> {
    return this.inFirm(firm.id, (tx) =>
      this.find(tx, firm.id, { tokenHash: claim.tokenHash, intakeId: claim.intakeId }),
    );
  }

  /** The form as the lead sees it, parsed before it leaves (a full SSN or EIN fails closed). */
  private async view(tx: TxClient, businessId: string, row: LinkRow): Promise<LinkIntake> {
    const definition = readDefinition(row.form, row.form.service.kind);
    const current = row.submissions[0];
    const signed = row.submissions.find((s) => s.submittedAt);
    const saved = new Set(current?.savedSteps ?? []);
    return LinkIntake.parse({
      id: row.id,
      form: IntakeFormKey.parse(row.form.service.kind),
      title: row.form.title,
      firstName: row.lead!.firstName,
      status: row.status,
      version: current?.version ?? 1,
      correction:
        row.correctionNote !== null && row.correctionRequestedAt !== null
          ? { note: row.correctionNote, requestedAt: iso(row.correctionRequestedAt) }
          : null,
      dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
      expiresAt: iso(row.accessTokenExpiresAt!),
      definition,
      taxYear: row.lead!.taxYear ?? new Date().getUTCFullYear(),
      answers: await maskStoredNumbers(definition, answersOf(current?.answers)),
      uploads: (await linkFiles(tx, businessId, row.id)).map(intakeUpload),
      maxFileSizeMb: await intakeFileSizeMb(tx, businessId),
      savedSteps: definition.steps.map((s) => s.key).filter((k) => saved.has(k)),
      signature:
        signed?.signerName && signed.signedAt
          ? { printedName: signed.signerName, signedAt: iso(signed.signedAt) }
          : null,
      canEdit: OPEN_STATUSES.includes(row.status),
    });
  }

  /** POST .../intake-link/open: the link's token for this browser's cookie, and the form. */
  async open(slug: string, token: string, res: Response): Promise<LinkIntake> {
    const firm = await this.portal.activeFirm(slug);
    const tokenHash = hashToken(token);
    const { intake, expiresAt } = await this.inFirm(firm.id, async (tx) => {
      const row = await this.find(tx, firm.id, { tokenHash });
      return { intake: await this.view(tx, firm.id, row), expiresAt: row.accessTokenExpiresAt! };
    });
    await this.cookies.write(res, firm, { intakeId: intake.id, tokenHash }, expiresAt, this.secure);
    await this.audit.log(
      'intake.link_opened',
      { type: 'intake', id: intake.id },
      {},
      { businessId: firm.id },
    );
    return intake;
  }

  /** GET .../intake-link. */
  async get(slug: string, req: Request): Promise<LinkIntake> {
    const { firm, claim } = await this.claim(slug, req);
    const intake = await this.inFirm(firm.id, async (tx) =>
      this.view(
        tx,
        firm.id,
        await this.find(tx, firm.id, { tokenHash: claim.tokenHash, intakeId: claim.intakeId }),
      ),
    );
    await this.audit.log(
      'intake.viewed',
      { type: 'intake', id: intake.id },
      { via: 'link' },
      { businessId: firm.id },
    );
    return intake;
  }

  /** GET .../intake-link/agreements: what the lead signs on the review step. */
  async agreements(slug: string, req: Request): Promise<IntakeAgreementBlock> {
    const { firm, claim } = await this.claim(slug, req);
    const row = await this.current(firm, claim);
    return this.agreementsService.linkIntakeBlock(firm.id, row.id);
  }

  /**
   * PUT .../intake-link/steps/{step}: autosave of the open version (saveIntakeStep). 410
   * LINK_INVALID, 409 INTAKE_LOCKED once sent, 400 VALIDATION_FAILED.
   */
  async saveStep(
    slug: string,
    req: Request,
    stepKey: string,
    answers: IntakeAnswersInput,
  ): Promise<SavedIntakeStep> {
    const { firm, claim } = await this.claim(slug, req);
    const row = await this.current(firm, claim);
    return this.saveOn(firm, row, stepKey, answers);
  }

  private async saveOn(
    firm: Firm,
    row: LinkRow,
    stepKey: string,
    answers: IntakeAnswersInput,
  ): Promise<SavedIntakeStep> {
    requireOpen(row.status);
    const draft = row.submissions[0];
    if (!draft || draft.submittedAt) throw intakeLocked();
    const definition = readDefinition(row.form, row.form.service.kind);
    const savedAt = await saveIntakeStep(
      { database: this.database, fe: this.fe },
      firm.id,
      row.id,
      definition,
      draft,
      stepKey,
      answers,
    );
    await this.audit.log(
      'intake.step_saved',
      { type: 'intake', id: row.id },
      { step: stepKey, version: draft.version, via: 'link' },
      { businessId: firm.id },
    );
    return { step: stepKey, savedAt: iso(savedAt) };
  }

  /**
   * POST .../intake-link/submit: the lead signs and sends the open version, as the portal's
   * submit does (IntakesService.submit): the review step's answers saved first, the whole form
   * checked, then in one transaction holding the intake row FOR NO KEY UPDATE the agreements signed
   * by the lead (R14's sign(): the firm's Terms and Privacy acceptance when it published both) and
   * the version locked, the intake SUBMITTED. 409 NO_INTAKE_AGREEMENT while the firm has no
   * firm-wide agreement; a save that lands meanwhile starts it again (409 INTAKE_CHANGED after
   * SUBMIT_ATTEMPTS). After commit: the firm's bell and the I7 notice, as for a client.
   */
  async submit(
    slug: string,
    req: Request,
    body: { answers?: IntakeAnswersInput; signature: z.output<typeof IntakeSignatureInput> },
    signer: IntakeSigner,
    source: { ip: string | null; userAgent: string | null },
  ): Promise<LinkIntake> {
    const { firm, claim } = await this.claim(slug, req);
    const first = await this.current(firm, claim);
    requireOpen(first.status);
    if (body.answers) {
      const definition = readDefinition(first.form, first.form.service.kind);
      await this.saveOn(firm, first, definition.steps.at(-1)!.key, body.answers);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.submitOnce(firm, claim, body, signer, source);
      } catch (error) {
        const again =
          error instanceof HttpException &&
          (error.getResponse() as { code?: string }).code === CHANGED;
        if (!again || attempt >= SUBMIT_ATTEMPTS) throw error;
      }
    }
  }

  private async submitOnce(
    firm: Firm,
    claim: LinkClaim,
    body: { signature: z.output<typeof IntakeSignatureInput> },
    signer: IntakeSigner,
    source: { ip: string | null; userAgent: string | null },
  ): Promise<LinkIntake> {
    const businessId = firm.id;
    const before = await this.current(firm, claim);
    requireOpen(before.status);
    const draft = before.submissions[0];
    if (!draft || draft.submittedAt) throw intakeLocked();
    const id = before.id;
    const definition = readDefinition(before.form, before.form.service.kind);
    const filesBefore = await this.inFirm(businessId, (tx) => slotFiles(tx, businessId, id));
    const { answers, hidden } = await prepareSubmit(
      this.fe,
      { businessId, intakeId: id },
      definition,
      answersOf(draft.answers),
      filesBefore,
    );
    const done = await this.inFirm(businessId, async (tx) => {
      // First, before counting files or signing: an upload confirm or a removal (same row lock)
      // waits for this submit and then finds the intake locked.
      await tx.$queryRaw`SELECT 1 FROM intakes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const row = await this.find(tx, businessId, { tokenHash: claim.tokenHash, intakeId: id });
      requireOpen(row.status);
      const current = row.submissions[0];
      if (current?.id !== draft.id || current.submittedAt) throw intakeLocked();
      if (JSON.stringify(current.answers) !== JSON.stringify(draft.answers)) throw changed();
      if (sameFiles(await slotFiles(tx, businessId, id)) !== sameFiles(filesBefore)) {
        throw changed();
      }
      await requireFirmWideAgreement(tx, businessId);
      // Files in slots the answers hide leave the form (a link file never moves): deleted while
      // the intake is still open, their objects after commit.
      const hiddenIds = hidden.map((f) => f.id);
      const dropped = hiddenIds.length
        ? await tx.leadUpload.findMany({
            where: { businessId, id: { in: hiddenIds } },
            select: { s3Key: true },
          })
        : [];
      if (hiddenIds.length) {
        await tx.leadUpload.deleteMany({ where: { businessId, id: { in: hiddenIds } } });
      }
      // Tickets the lead took and never confirmed: their objects go too.
      const kept = new Set(
        (
          await tx.leadUpload.findMany({
            where: { businessId, intakeId: id },
            select: { s3Key: true },
          })
        ).map((f) => f.s3Key),
      );
      const since = row.sentAt ?? new Date(0);
      const tickets = await ticketKeys(tx, businessId, row.leadId!, since, { intakeId: id });
      const unconfirmed = tickets.filter((k) => !kept.has(k));
      const ids = { businessId, intakeId: id, submissionId: draft.id };
      await lockVersion(tx, ids, answers, null, () =>
        signer.sign(tx, {
          ...ids,
          serviceId: row.form.serviceId,
          signer: { kind: 'lead', leadId: row.leadId!, email: row.lead!.email },
          signature: body.signature,
          ...source,
        }),
      );
      await this.audit.logIn(
        tx,
        'intake.submitted',
        { type: 'intake', id },
        { version: draft.version, via: 'link', detached: hiddenIds.length },
        { businessId },
      );
      const view = await this.view(
        tx,
        businessId,
        await this.find(tx, businessId, { tokenHash: claim.tokenHash, intakeId: id }),
      );
      return { view, objects: [...dropped.map((f) => f.s3Key), ...unconfirmed] };
    });
    for (const key of done.objects) {
      await this.storage.remove(key).catch((error: unknown) => {
        this.logger.warn(`Could not delete a link file of intake ${id} (${errorName(error)})`);
      });
    }
    const intake = done.view;
    try {
      await this.notifier.notify({ businessId, event: 'intake.submitted', recordId: id });
    } catch (error) {
      this.logger.warn(`intake.submitted for intake ${id} not written (${errorName(error)})`);
    }
    await sendSubmittedNotice(
      { database: this.database, notify: this.notify, env: this.env, logger: this.logger },
      businessId,
      id,
    );
    return intake;
  }
}

/** The intake's link files as submit counts them (lead_uploads naming the intake). */
async function slotFiles(tx: TxClient, businessId: string, intakeId: string): Promise<SlotFile[]> {
  return (await linkFiles(tx, businessId, intakeId)).map((f) => ({
    id: f.id,
    slot: f.slot,
    status: f.scanStatus,
  }));
}

/** Counted or not, as the check used them: a scan going PENDING to CLEAN changes nothing. */
const sameFiles = (files: SlotFile[]) =>
  JSON.stringify(files.map((f) => [f.id, f.slot, COUNTED_UPLOAD_STATUSES.includes(f.status)]));
