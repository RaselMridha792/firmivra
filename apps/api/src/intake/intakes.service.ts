import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { z } from 'zod';
import {
  checkIntakeAnswers,
  COUNTED_UPLOAD_STATUSES,
  INTAKE_ERRORS,
  INTAKE_UPLOAD_STATUS,
  type IntakeAnswersInput,
  IntakeFormKey,
  type IntakeSignatureInput,
  type IntakeStatus,
  IntakeSummary,
  type IntakeUpload,
  IntakeView,
  MyIntake,
  MyIntakeListItem,
  type NotificationEvent,
  restoreMaskedNumbers,
  type SavedIntakeStep,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { requireFirmWideAgreement } from './intake-agreement.js';
import { publishedForm, readDefinition } from './intake-forms.js';
import { maskStoredNumbers, sealIntakeNumbers } from './intake-numbers.js';
import type { IntakeSigner } from './intake-signing.js';
import { lockVersion, prepareSubmit, type SlotFile } from './intake-submit.js';

/** Statuses in which the client can change the answers (contract B's INTAKE_EDITABLE_STATUSES). */
export const OPEN_STATUSES: IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];
/** An engagement has at most one live intake: a new one only after it expired or was archived. */
const LIVE_STATUSES: IntakeStatus[] = [...OPEN_STATUSES, 'SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const locked = () => conflict('INTAKE_LOCKED', INTAKE_ERRORS.INTAKE_LOCKED);
const expired = () =>
  new GoneException({ code: 'INTAKE_EXPIRED', message: INTAKE_ERRORS.INTAKE_EXPIRED });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
const invalidStatus = () => conflict('INVALID_STATUS', 'Not possible in this status');
const CHANGED = 'INTAKE_CHANGED';
const changed = () =>
  conflict(CHANGED, 'The form changed while it was being sent. Review it and send again.');
/** How often a submit starts again when a save or an upload landed while it checked the form. */
const SUBMIT_ATTEMPTS = 3;

/** 409 INTAKE_LOCKED, or 410 INTAKE_EXPIRED, unless the intake is open for changes. */
export function requireOpen(status: IntakeStatus): void {
  if (status === 'EXPIRED') throw expired();
  if (!OPEN_STATUSES.includes(status)) throw locked();
}

/**
 * Contract B's gate for a change (save, upload, remove, submit), after the 404: 403 FORBIDDEN for
 * a login that is not the client's PRIMARY one, then 410 INTAKE_EXPIRED or 409 INTAKE_LOCKED.
 */
export function requireChangeable(status: IntakeStatus, who: { primary: boolean }): void {
  if (!who.primary) throw forbidden();
  requireOpen(status);
}

/** The signed-in client (from the session, never the URL) and whether it is the PRIMARY login. */
export interface PortalClient {
  kind: 'client';
  clientId: string;
  primary: boolean;
}

/** Who may reach an intake: the client of its engagement (portal) or a member (firm). */
export type IntakeReach = PortalClient | { kind: 'staff'; actor: ClientsActor };

const summarySelect = {
  id: true,
  status: true,
  dueOn: true,
  correctionNote: true,
  correctionRequestedAt: true,
  createdAt: true,
  updatedAt: true,
  form: { select: { version: true, title: true, definition: true } },
  engagement: {
    select: {
      id: true,
      title: true,
      taxYear: true,
      service: { select: { id: true, name: true, kind: true } },
    },
  },
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
      updatedAt: true,
    },
  },
} satisfies Prisma.IntakeSelect;

/** The list's columns: no definition or answers (contract B's MyIntakeListItem). */
const listSelect = {
  ...summarySelect,
  form: { select: { version: true, title: true } },
  submissions: {
    orderBy: { version: 'desc' },
    take: 2,
    select: { id: true, version: true, submittedAt: true, updatedAt: true },
  },
} satisfies Prisma.IntakeSelect;

type Row = Prisma.IntakeGetPayload<{ select: typeof summarySelect }>;
type ListRow = Prisma.IntakeGetPayload<{ select: typeof listSelect }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const answersOf = (v: unknown) => (v ?? {}) as Record<string, unknown>;

export const uploadSelect = {
  id: true,
  intakeSlot: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  scanStatus: true,
  createdAt: true,
} satisfies Prisma.DocumentSelect;
type UploadRow = Prisma.DocumentGetPayload<{ select: typeof uploadSelect }>;

/** A slot file as contract B shows it (CHECKING, READY or BLOCKED; never why it is blocked). */
export function toIntakeUpload(u: UploadRow): IntakeUpload {
  return {
    id: u.id,
    slot: u.intakeSlot ?? '',
    fileName: u.fileName,
    contentType: u.contentType,
    sizeBytes: u.sizeBytes,
    status: INTAKE_UPLOAD_STATUS[u.scanStatus],
    uploadedAt: u.createdAt.toISOString(),
  };
}

/** The firm's summary (intakes.ts). */
function toSummary(row: Row): IntakeSummary {
  const engagement = row.engagement!;
  const current = row.submissions[0];
  const sent = row.submissions.find((s) => s.submittedAt);
  return {
    id: row.id,
    status: row.status,
    service: engagement.service,
    engagement: { id: engagement.id, title: engagement.title, taxYear: engagement.taxYear },
    formVersion: row.form.version,
    version: current?.version ?? 1,
    dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
    correctionNote: row.correctionNote,
    correctionRequestedAt: iso(row.correctionRequestedAt),
    submittedAt: iso(sent?.submittedAt ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Contract B's row of the Intake Forms tab (`service.id` is the engagement's id); `updatedAt` is
 * the intake's or its newest version's last change, whichever is later.
 */
function toListItem(row: ListRow): MyIntakeListItem {
  const engagement = row.engagement!;
  const current = row.submissions[0];
  const sent = row.submissions.find((s) => s.submittedAt);
  const updated = Math.max(row.updatedAt.getTime(), current?.updatedAt.getTime() ?? 0);
  return {
    id: row.id,
    form: IntakeFormKey.parse(engagement.service.kind),
    title: row.form.title,
    service: { id: engagement.id, title: engagement.title },
    status: row.status,
    dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
    version: current?.version ?? 1,
    submittedAt: iso(sent?.submittedAt ?? null),
    correction:
      row.correctionNote !== null && row.correctionRequestedAt !== null
        ? { note: row.correctionNote, requestedAt: row.correctionRequestedAt.toISOString() }
        : null,
    updatedAt: new Date(updated).toISOString(),
  };
}

const editable = (s: IntakeStatus) => OPEN_STATUSES.includes(s);
/** Contract B's order: open ones first by due date (none last), then the newest. */
const listOrder = (a: MyIntakeListItem, b: MyIntakeListItem) =>
  Number(editable(b.status)) - Number(editable(a.status)) ||
  (editable(a.status) ? (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') : 0) ||
  b.updatedAt.localeCompare(a.updatedAt) ||
  b.id.localeCompare(a.id);

/**
 * Portal intake forms (contract B, packages/types/src/intake/schemas.ts and client.ts) and the
 * firm's side of them (intakes.ts: send, review, Needs Correction, unlock). Answers are versioned
 * in intake_submissions: one draft at a time, a submitted version locked (database rules). SSN
 * and EIN answers are sealed at rest (intake-numbers.ts) and returned as `{ last4 }`; every portal
 * response is parsed with contract B's schema before it leaves, so a full number fails closed.
 */
@Injectable()
export class IntakesService {
  private readonly logger = new Logger(IntakesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  /**
   * The bell (and the event's email copy) through R6's Notifier once a change committed: the
   * Notifier reads the safe values from the intake itself. It resolves on a database failure;
   * anything else is logged with the intake's id only and never undoes the change.
   */
  private async tell(
    businessId: string,
    event: NotificationEvent,
    intakeId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.notifier.notify({ businessId, event, recordId: intakeId, actorUserId });
    } catch (error) {
      this.logger.warn(`${event} for intake ${intakeId} not written (${errorName(error)})`);
    }
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The session's client (never from the URL) and whether this login is its PRIMARY one. */
  async clientOf(businessId: string, clientAccountId: string): Promise<PortalClient> {
    const account = await this.database.forBusiness(businessId).clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true, portalRole: true },
    });
    if (!account?.clientId) throw notFound();
    return {
      kind: 'client',
      clientId: account.clientId,
      primary: account.portalRole === 'PRIMARY',
    };
  }

  private clientWhere(reach: IntakeReach): Prisma.ClientWhereInput {
    if (reach.kind === 'client') return { id: reach.clientId };
    return reach.actor.role === 'STAFF' ? { assignedUserId: reach.actor.userId } : {};
  }

  private async row(tx: TxClient, businessId: string, reach: IntakeReach, id: string) {
    const row = await tx.intake.findFirst({
      where: { businessId, id, engagement: { client: this.clientWhere(reach) } },
      select: summarySelect,
    });
    if (!row?.engagement) throw notFound();
    return row;
  }

  private uploadsOf(tx: TxClient, businessId: string, intakeId: string) {
    return tx.document.findMany({
      where: { businessId, intakeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: uploadSelect,
    });
  }

  /** The firm's view (intakes.ts), parsed before it leaves as MyIntake is. */
  private async view(tx: TxClient, businessId: string, row: Row): Promise<IntakeView> {
    const definition = readDefinition(row.form, row.engagement!.service.kind);
    const current = row.submissions[0];
    const uploads = await this.uploadsOf(tx, businessId, row.id);
    return IntakeView.parse({
      ...toSummary(row),
      definition,
      answers: await maskStoredNumbers(definition, answersOf(current?.answers)),
      savedSteps: current?.savedSteps ?? [],
      locked: !OPEN_STATUSES.includes(row.status),
      uploads: uploads.map((u) => ({
        documentId: u.id,
        slot: u.intakeSlot ?? '',
        fileName: u.fileName,
        contentType: u.contentType,
        sizeBytes: u.sizeBytes,
        scanStatus: u.scanStatus,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  }

  /**
   * Contract B's MyIntake, parsed before it leaves: a full SSN or EIN, an answer outside the form
   * or a shape the contract doesn't allow throws (500) instead of being sent.
   */
  private async myIntake(
    tx: TxClient,
    businessId: string,
    row: Row,
    who: PortalClient,
  ): Promise<MyIntake> {
    const engagement = row.engagement!;
    const definition = readDefinition(row.form, engagement.service.kind);
    const current = row.submissions[0];
    const signedVersion = row.submissions.find((s) => s.submittedAt);
    const saved = new Set(current?.savedSteps ?? []);
    const uploads = await this.uploadsOf(tx, businessId, row.id);
    const open = who.primary && OPEN_STATUSES.includes(row.status);
    return MyIntake.parse({
      ...toListItem(row),
      definition,
      taxYear: engagement.taxYear ?? new Date().getUTCFullYear(),
      answers: await maskStoredNumbers(definition, answersOf(current?.answers)),
      uploads: uploads.map(toIntakeUpload),
      savedSteps: definition.steps.map((s) => s.key).filter((k) => saved.has(k)),
      signature:
        signedVersion?.signerName && signedVersion.signedAt
          ? {
              printedName: signedVersion.signerName,
              signedAt: signedVersion.signedAt.toISOString(),
            }
          : null,
      canEdit: open,
      canSubmit: open,
    });
  }

  /** GET /portal/{slug}/me/intakes: the client's intakes, in contract B's order. */
  async listMine(businessId: string, who: PortalClient): Promise<MyIntakeListItem[]> {
    const rows = await this.inFirm(businessId, (tx) =>
      tx.intake.findMany({
        where: { businessId, engagement: { clientId: who.clientId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: listSelect,
      }),
    );
    await this.audit.log('intakes.listed', { type: 'intake' }, { count: rows.length });
    return rows.map((r) => MyIntakeListItem.parse(toListItem(r))).sort(listOrder);
  }

  /** GET /portal/{slug}/me/intakes/{id}. */
  async getMine(businessId: string, who: PortalClient, id: string): Promise<MyIntake> {
    const intake = await this.inFirm(businessId, async (tx) =>
      this.myIntake(tx, businessId, await this.row(tx, businessId, who, id), who),
    );
    await this.audit.log('intake.viewed', { type: 'intake', id });
    return intake;
  }

  /** A client's intakes, for the members who reach the client (firm). */
  async list(
    businessId: string,
    reach: IntakeReach & { kind: 'staff' },
    clientId: string,
  ): Promise<IntakeSummary[]> {
    const rows = await this.inFirm(businessId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { businessId, id: clientId, ...this.clientWhere(reach) },
        select: { id: true },
      });
      if (!client) throw notFound();
      return tx.intake.findMany({
        where: { businessId, engagement: { client: { ...this.clientWhere(reach), id: clientId } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: summarySelect,
      });
    });
    await this.audit.log('intakes.listed', { type: 'intake' }, { count: rows.length });
    return rows.map((r) => IntakeSummary.parse(toSummary(r)));
  }

  async get(businessId: string, reach: IntakeReach, id: string): Promise<IntakeView> {
    const view = await this.inFirm(businessId, async (tx) =>
      this.view(tx, businessId, await this.row(tx, businessId, reach, id)),
    );
    await this.audit.log('intake.viewed', { type: 'intake', id });
    return view;
  }

  /**
   * The firm sends the client an intake for an ACTIVE engagement the member reaches, on its
   * service's published form, with an empty version 1 (SENT). One live intake per engagement
   * (corrections and unlocking make new versions of it): 409 INTAKE_OPEN.
   */
  async start(
    businessId: string,
    reach: IntakeReach & { kind: 'staff' },
    engagementId: string,
    options: { dueOn?: string; userId: string },
  ): Promise<IntakeView> {
    const view = await this.inFirm(businessId, async (tx) => {
      const engagement = await tx.engagement.findFirst({
        where: { businessId, id: engagementId, client: this.clientWhere(reach) },
        select: { id: true, status: true, service: { select: { id: true, kind: true } } },
      });
      if (!engagement) throw notFound();
      // Held so two sends of one engagement run one at a time.
      await tx.$executeRaw`SELECT 1 FROM engagements WHERE id = ${engagement.id}::uuid FOR UPDATE`;
      if (engagement.status !== 'ACTIVE') {
        throw conflict('ENGAGEMENT_NOT_ACTIVE', 'This service is not active');
      }
      const open = await tx.intake.findFirst({
        where: { businessId, engagementId, status: { in: LIVE_STATUSES } },
        select: { id: true },
      });
      if (open) throw conflict('INTAKE_OPEN', 'An intake of this service is open');
      const form = await publishedForm(tx, businessId, engagement.service);
      if (!form) throw conflict('NO_INTAKE_FORM', 'This service has no intake form');
      const intake = await tx.intake.create({
        data: {
          businessId,
          formId: form.id,
          engagementId,
          status: 'SENT',
          dueOn: options.dueOn ? new Date(`${options.dueOn}T00:00:00Z`) : null,
          createdByUserId: options.userId,
        },
        select: { id: true },
      });
      await tx.intakeSubmission.create({ data: { businessId, intakeId: intake.id, version: 1 } });
      return this.view(tx, businessId, await this.row(tx, businessId, reach, intake.id));
    });
    await this.audit.log('intake.sent', { type: 'intake', id: view.id }, { engagementId });
    await this.tell(businessId, 'intake.sent', view.id, options.userId);
    return view;
  }

  /**
   * PUT .../steps/{step} (autosave of the open version): 404, 403 for a login that isn't the
   * PRIMARY one, 410 INTAKE_EXPIRED, 409 INTAKE_LOCKED, then the answers (400 VALIDATION_FAILED,
   * 400 TOO_MANY_NUMBERS, 503 ENCRYPTION_UNAVAILABLE). A SENT intake becomes IN_PROGRESS.
   */
  async saveStep(
    businessId: string,
    who: PortalClient,
    id: string,
    stepKey: string,
    answers: IntakeAnswersInput,
  ): Promise<SavedIntakeStep> {
    // Read and check outside the transaction (sealing calls KMS), then write with a recheck.
    const before = await this.inFirm(businessId, (tx) => this.row(tx, businessId, who, id));
    requireChangeable(before.status, who);
    const definition = readDefinition(before.form, before.engagement!.service.kind);
    const draft = before.submissions[0];
    if (!draft || draft.submittedAt) throw locked();
    const stored = answersOf(draft.answers);
    const checked = checkIntakeAnswers(definition, answers, { mode: 'save', step: stepKey });
    const restored = restoreMaskedNumbers(
      definition,
      checked.answers,
      await maskStoredNumbers(definition, stored),
    );
    const issues = [...checked.issues, ...restored.issues];
    if (issues.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Some answers need attention',
        details: { issues },
      });
    }
    const sealed = await sealIntakeNumbers(
      this.fe,
      { businessId, intakeId: id },
      definition,
      restored.answers,
      stored,
    );
    const step = definition.steps.find((s) => s.key === stepKey)!;
    const stepKeys = new Set(step.sections.flatMap((s) => s.fields.map((f) => f.key)));
    const savedAt = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.$queryRaw<{ status: IntakeStatus }[]>`
        SELECT status::text AS status FROM intakes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const current = await tx.intakeSubmission.findFirst({
        where: { businessId, intakeId: id },
        orderBy: { version: 'desc' },
        select: { id: true, submittedAt: true, savedSteps: true, answers: true },
      });
      if (!rows[0]) throw notFound();
      requireOpen(rows[0].status);
      if (current?.id !== draft.id || current.submittedAt) throw locked();
      // Merged onto the answers as they are now, under the lock: a save of another step that
      // landed since the read above is kept.
      const merged = Object.fromEntries(
        Object.entries(answersOf(current.answers)).filter(([k]) => !stepKeys.has(k)),
      );
      Object.assign(merged, sealed);
      const updated = await tx.intakeSubmission.update({
        where: { id: draft.id },
        data: {
          answers: merged as Prisma.InputJsonValue,
          savedSteps: current.savedSteps.includes(stepKey)
            ? current.savedSteps
            : [...current.savedSteps, stepKey],
        },
        select: { updatedAt: true },
      });
      if (rows[0].status === 'SENT') {
        await tx.intake.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      }
      return updated.updatedAt;
    });
    await this.audit.log(
      'intake.step_saved',
      { type: 'intake', id },
      { step: stepKey, version: draft.version },
    );
    return { step: stepKey, savedAt: savedAt.toISOString() };
  }

  /** SUBMITTED to UNDER_REVIEW, or SUBMITTED/UNDER_REVIEW to COMPLETED (firm). */
  async move(
    businessId: string,
    reach: IntakeReach,
    id: string,
    to: 'UNDER_REVIEW' | 'COMPLETED',
  ): Promise<IntakeView> {
    const from: IntakeStatus[] =
      to === 'UNDER_REVIEW' ? ['SUBMITTED'] : ['SUBMITTED', 'UNDER_REVIEW'];
    const view = await this.inFirm(businessId, async (tx) => {
      const row = await this.lockRow(tx, businessId, reach, id);
      if (!from.includes(row.status)) throw invalidStatus();
      await tx.intake.update({ where: { id }, data: { status: to } });
      return this.view(tx, businessId, await this.row(tx, businessId, reach, id));
    });
    await this.audit.log(to === 'COMPLETED' ? 'intake.completed' : 'intake.review_started', {
      type: 'intake',
      id,
    });
    return view;
  }

  /**
   * Owner and Admin: the next version from the last submitted answers, as a draft to sign again.
   * With a note: NEEDS_CORRECTION; without (unlock): IN_PROGRESS.
   */
  async reopen(
    businessId: string,
    reach: IntakeReach,
    id: string,
    note: string | null,
  ): Promise<IntakeView> {
    if (reach.kind !== 'staff' || reach.actor.role === 'STAFF') throw forbidden();
    const from: IntakeStatus[] =
      note === null ? ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'] : ['SUBMITTED', 'UNDER_REVIEW'];
    const { view, version } = await this.inFirm(businessId, async (tx) => {
      const row = await this.lockRow(tx, businessId, reach, id);
      const last = row.submissions[0];
      if (!from.includes(row.status) || !last?.submittedAt) throw invalidStatus();
      await tx.intakeSubmission.create({
        data: {
          businessId,
          intakeId: id,
          version: last.version + 1,
          answers: last.answers as Prisma.InputJsonValue,
          savedSteps: last.savedSteps,
        },
      });
      await tx.intake.update({
        where: { id },
        data:
          note === null
            ? { status: 'IN_PROGRESS' }
            : { status: 'NEEDS_CORRECTION', correctionNote: note },
      });
      return {
        view: await this.view(tx, businessId, await this.row(tx, businessId, reach, id)),
        version: last.version + 1,
      };
    });
    // The note is free text about the client's answers: never in the audit metadata.
    await this.audit.log(
      note === null ? 'intake.unlocked' : 'intake.correction_requested',
      { type: 'intake', id },
      { version },
    );
    return view;
  }

  /**
   * The client signs and sends the open version (POST .../submit, contract B's
   * SubmitIntakeRequest; answers MyIntake). 404, then 403 for a login that isn't the PRIMARY one,
   * 410 INTAKE_EXPIRED, 409 INTAKE_LOCKED. `answers`, when sent, are the review step's and are
   * saved first as a save of that step (they stay saved if the submit is then refused). Then the
   * whole form is checked and, in one transaction run as the client's login (the database checks
   * that the signature is that login's) that starts by holding the intake row FOR NO KEY UPDATE:
   * the files in slots the answers hide taken out of it, 409 NO_INTAKE_AGREEMENT while the firm
   * has no published firm-wide agreement, the agreements signed (`signer`, INTAKE_SIGNING), then
   * the version locked with the signer's evidence and the intake SUBMITTED. A portal signature
   * takes no Terms and Privacy acceptance (400 VALIDATION_FAILED). A save or an upload that lands
   * between the check and the lock starts the submit again (at most SUBMIT_ATTEMPTS times, then
   * 409 INTAKE_CHANGED), so what was checked is what is locked; one that comes while the submit
   * holds the row waits and then finds it locked.
   */
  async submit(
    businessId: string,
    who: PortalClient,
    id: string,
    login: { userId: string; clientAccountId: string },
    body: { answers?: IntakeAnswersInput; signature: z.output<typeof IntakeSignatureInput> },
    signer: IntakeSigner,
    source: { ip: string | null; userAgent: string | null },
  ): Promise<MyIntake> {
    if (body.signature.acceptLegal) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'A portal intake takes no Terms and Privacy acceptance',
      });
    }
    const first = await this.inFirm(businessId, (tx) => this.row(tx, businessId, who, id));
    requireChangeable(first.status, who);
    if (body.answers) {
      const definition = readDefinition(first.form, first.engagement!.service.kind);
      const review = definition.steps.at(-1)!;
      await this.saveStep(businessId, who, id, review.key, body.answers);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.submitOnce(businessId, who, id, login, body, signer, source);
      } catch (error) {
        const again =
          error instanceof HttpException &&
          (error.getResponse() as { code?: string }).code === CHANGED;
        if (!again || attempt >= SUBMIT_ATTEMPTS) throw error;
      }
    }
  }

  private async submitOnce(
    businessId: string,
    who: PortalClient,
    id: string,
    login: { userId: string; clientAccountId: string },
    body: { signature: z.output<typeof IntakeSignatureInput> },
    signer: IntakeSigner,
    source: { ip: string | null; userAgent: string | null },
  ): Promise<MyIntake> {
    const before = await this.inFirm(businessId, async (tx) => ({
      row: await this.row(tx, businessId, who, id),
      files: await this.slotFiles(tx, businessId, id),
    }));
    requireChangeable(before.row.status, who);
    const draft = before.row.submissions[0];
    if (!draft || draft.submittedAt) throw locked();
    const service = before.row.engagement!.service;
    const definition = readDefinition(before.row.form, service.kind);
    const { answers, hidden } = await prepareSubmit(
      this.fe,
      { businessId, intakeId: id },
      definition,
      answersOf(draft.answers),
      before.files,
    );
    const asSigner = { kind: 'business' as const, businessId, actorUserId: login.userId };
    const intake = await this.database.withScope(asSigner, async (tx) => {
      // First, before counting files, detaching or signing: an upload confirm or a file removal
      // (same row lock) waits for this submit and then finds the intake locked.
      await tx.$queryRaw`SELECT 1 FROM intakes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const row = await this.row(tx, businessId, who, id);
      requireOpen(row.status);
      const current = row.submissions[0];
      if (current?.id !== draft.id || current.submittedAt) throw locked();
      const files = await this.slotFiles(tx, businessId, id);
      // Counted or not, as the check used them: a scan going PENDING to CLEAN changes nothing.
      const key = (files: SlotFile[]) =>
        JSON.stringify(
          files.map((f) => [f.id, f.slot, COUNTED_UPLOAD_STATUSES.includes(f.status)]),
        );
      const same = (a: SlotFile[], b: SlotFile[]) => key(a) === key(b);
      if (JSON.stringify(current.answers) !== JSON.stringify(draft.answers)) throw changed();
      if (!same(files, before.files)) throw changed();
      await requireFirmWideAgreement(tx, businessId);
      if (hidden.length > 0) {
        await tx.document.updateMany({
          where: { businessId, id: { in: hidden.map((f) => f.id) } },
          data: { intakeId: null, intakeSlot: null },
        });
      }
      const ids = { businessId, intakeId: id, submissionId: draft.id };
      await lockVersion(tx, ids, answers, login.userId, () =>
        signer.sign(tx, {
          ...ids,
          serviceId: service.id,
          signer: { kind: 'client', clientAccountId: login.clientAccountId },
          signature: body.signature,
          ...source,
        }),
      );
      return this.myIntake(tx, businessId, await this.row(tx, businessId, who, id), who);
    });
    await this.audit.log(
      'intake.submitted',
      { type: 'intake', id },
      { version: draft.version, detached: hidden.length },
    );
    await this.tell(businessId, 'intake.submitted', id, login.userId);
    return intake;
  }

  /** The files in the intake's upload slots, oldest first. */
  private async slotFiles(tx: TxClient, businessId: string, intakeId: string): Promise<SlotFile[]> {
    const docs = await tx.document.findMany({
      where: { businessId, intakeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, intakeSlot: true, scanStatus: true },
    });
    return docs.map((d) => ({ id: d.id, slot: d.intakeSlot ?? '', status: d.scanStatus }));
  }

  private async lockRow(tx: TxClient, businessId: string, reach: IntakeReach, id: string) {
    await this.row(tx, businessId, reach, id); // 404 before taking the lock
    await tx.$executeRaw`SELECT 1 FROM intakes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return this.row(tx, businessId, reach, id);
  }
}
