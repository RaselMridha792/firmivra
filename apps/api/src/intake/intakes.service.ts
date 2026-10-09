import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  checkIntakeAnswers,
  type IntakeAnswersInput,
  type IntakeChoice,
  type IntakeStatus,
  type IntakeSummary,
  type IntakeView,
  restoreMaskedNumbers,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { publishedForm, readDefinition } from './intake-forms.js';
import { maskStoredNumbers, sealIntakeNumbers } from './intake-numbers.js';

/** Statuses in which the client can change the answers. */
export const OPEN_STATUSES: IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];
/** An engagement has at most one live intake: a new one only after it expired or was archived. */
const LIVE_STATUSES: IntakeStatus[] = [...OPEN_STATUSES, 'SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const locked = () => conflict('INTAKE_LOCKED', 'This form was already sent to the firm');
const invalidStatus = () => conflict('INVALID_STATUS', 'Not possible in this status');

/** Who may reach an intake: the client of its engagement (portal) or a member (firm). */
export type IntakeReach =
  { kind: 'client'; clientId: string } | { kind: 'staff'; actor: ClientsActor };

const summarySelect = {
  id: true,
  status: true,
  dueOn: true,
  correctionNote: true,
  correctionRequestedAt: true,
  createdAt: true,
  updatedAt: true,
  form: { select: { version: true, definition: true } },
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
    select: { id: true, version: true, answers: true, savedSteps: true, submittedAt: true },
  },
} satisfies Prisma.IntakeSelect;

type Row = Prisma.IntakeGetPayload<{ select: typeof summarySelect }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const answersOf = (v: unknown) => (v ?? {}) as Record<string, unknown>;

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
 * Portal intake forms and the firm's side of them (R11 steps 5 and Needs Correction). Answers are
 * versioned in intake_submissions: one draft at a time, a submitted version locked (database
 * rules). SSN and EIN answers are sealed at rest (intake-numbers.ts) and returned as last 4.
 */
@Injectable()
export class IntakesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The session's client (never from the URL). */
  async clientOf(businessId: string, clientAccountId: string): Promise<IntakeReach> {
    const account = await this.database.forBusiness(businessId).clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
    });
    if (!account?.clientId) throw notFound();
    return { kind: 'client', clientId: account.clientId };
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

  private async view(tx: TxClient, businessId: string, row: Row): Promise<IntakeView> {
    const definition = readDefinition(row.form, row.engagement!.service.kind);
    const current = row.submissions[0];
    const uploads = await tx.document.findMany({
      where: { businessId, intakeId: row.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        intakeSlot: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        scanStatus: true,
        createdAt: true,
      },
    });
    return {
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
    };
  }

  async list(businessId: string, reach: IntakeReach, clientId?: string): Promise<IntakeSummary[]> {
    const rows = await this.inFirm(businessId, async (tx) => {
      if (clientId) {
        const client = await tx.client.findFirst({
          where: { businessId, id: clientId, ...this.clientWhere(reach) },
          select: { id: true },
        });
        if (!client) throw notFound();
      }
      return tx.intake.findMany({
        where: {
          businessId,
          engagement: {
            client: { ...this.clientWhere(reach), ...(clientId ? { id: clientId } : {}) },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: summarySelect,
      });
    });
    await this.audit.log('intakes.listed', { type: 'intake' }, { count: rows.length });
    return rows.map(toSummary);
  }

  /** Each ACTIVE engagement of the client whose service has a form, and its newest intake. */
  async choices(
    businessId: string,
    reach: IntakeReach & { kind: 'client' },
  ): Promise<IntakeChoice[]> {
    const engagements = await this.database.forBusiness(businessId).engagement.findMany({
      where: {
        businessId,
        clientId: reach.clientId,
        status: 'ACTIVE',
        service: { kind: { not: 'OTHER' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        taxYear: true,
        service: { select: { id: true, name: true, kind: true } },
        intakes: { orderBy: { createdAt: 'desc' }, take: 1, select: summarySelect },
      },
    });
    await this.audit.log(
      'intake_choices.listed',
      { type: 'intake' },
      { count: engagements.length },
    );
    return engagements.map((e) => ({
      engagement: { id: e.id, title: e.title, taxYear: e.taxYear },
      service: e.service,
      intake: e.intakes[0] ? toSummary(e.intakes[0]) : null,
    }));
  }

  async get(businessId: string, reach: IntakeReach, id: string): Promise<IntakeView> {
    const view = await this.inFirm(businessId, async (tx) =>
      this.view(tx, businessId, await this.row(tx, businessId, reach, id)),
    );
    await this.audit.log('intake.viewed', { type: 'intake', id });
    return view;
  }

  /**
   * A new intake for an ACTIVE engagement the caller reaches, on its service's published form,
   * with an empty version 1. One live intake per engagement (corrections and unlocking make new
   * versions of it): portal, the live one comes back as it is; firm (send), it is 409 INTAKE_OPEN.
   */
  async start(
    businessId: string,
    reach: IntakeReach,
    engagementId: string,
    options: { dueOn?: string; userId?: string } = {},
  ): Promise<IntakeView> {
    const { view, created } = await this.inFirm(businessId, async (tx) => {
      const engagement = await tx.engagement.findFirst({
        where: { businessId, id: engagementId, client: this.clientWhere(reach) },
        select: { id: true, status: true, service: { select: { id: true, kind: true } } },
      });
      if (!engagement) throw notFound();
      // Held so two starts of one engagement run one at a time.
      await tx.$executeRaw`SELECT 1 FROM engagements WHERE id = ${engagement.id}::uuid FOR UPDATE`;
      if (engagement.status !== 'ACTIVE') {
        throw conflict('ENGAGEMENT_NOT_ACTIVE', 'This service is not active');
      }
      const open = await tx.intake.findFirst({
        where: { businessId, engagementId, status: { in: LIVE_STATUSES } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (open) {
        if (reach.kind === 'staff')
          throw conflict('INTAKE_OPEN', 'An intake of this service is open');
        return {
          view: await this.view(tx, businessId, await this.row(tx, businessId, reach, open.id)),
          created: false,
        };
      }
      const form = await publishedForm(tx, businessId, engagement.service);
      if (!form) throw conflict('NO_INTAKE_FORM', 'This service has no intake form');
      const intake = await tx.intake.create({
        data: {
          businessId,
          formId: form.id,
          engagementId,
          status: reach.kind === 'client' ? 'IN_PROGRESS' : 'SENT',
          dueOn: options.dueOn ? new Date(`${options.dueOn}T00:00:00Z`) : null,
          createdByUserId: options.userId ?? null,
        },
        select: { id: true },
      });
      await tx.intakeSubmission.create({ data: { businessId, intakeId: intake.id, version: 1 } });
      return {
        view: await this.view(tx, businessId, await this.row(tx, businessId, reach, intake.id)),
        created: true,
      };
    });
    if (created) {
      await this.audit.log(
        reach.kind === 'client' ? 'intake.started' : 'intake.sent',
        { type: 'intake', id: view.id },
        { engagementId },
      );
    }
    return view;
  }

  /** Autosave of one step of the open version (portal). */
  async saveStep(
    businessId: string,
    reach: IntakeReach,
    id: string,
    stepKey: string,
    answers: IntakeAnswersInput,
  ): Promise<IntakeView> {
    // Read and check outside the transaction (sealing calls KMS), then write with a recheck.
    const before = await this.inFirm(businessId, (tx) => this.row(tx, businessId, reach, id));
    if (!OPEN_STATUSES.includes(before.status)) throw locked();
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
    const view = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.$queryRaw<{ status: IntakeStatus }[]>`
        SELECT status::text AS status FROM intakes WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.intakeSubmission.findFirst({
        where: { businessId, intakeId: id },
        orderBy: { version: 'desc' },
        select: { id: true, submittedAt: true, savedSteps: true, answers: true },
      });
      if (
        !rows[0] ||
        !OPEN_STATUSES.includes(rows[0].status) ||
        current?.id !== draft.id ||
        current.submittedAt
      ) {
        throw locked();
      }
      // Merged onto the answers as they are now, under the lock: a save of another step that
      // landed since the read above is kept.
      const merged = Object.fromEntries(
        Object.entries(answersOf(current.answers)).filter(([k]) => !stepKeys.has(k)),
      );
      Object.assign(merged, sealed);
      await tx.intakeSubmission.update({
        where: { id: draft.id },
        data: {
          answers: merged as Prisma.InputJsonValue,
          savedSteps: current.savedSteps.includes(stepKey)
            ? current.savedSteps
            : [...current.savedSteps, stepKey],
        },
      });
      if (rows[0].status === 'SENT') {
        await tx.intake.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      }
      return this.view(tx, businessId, await this.row(tx, businessId, reach, id));
    });
    await this.audit.log(
      'intake.step_saved',
      { type: 'intake', id },
      { step: stepKey, version: draft.version },
    );
    return view;
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
    if (reach.kind !== 'staff' || reach.actor.role === 'STAFF') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
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

  private async lockRow(tx: TxClient, businessId: string, reach: IntakeReach, id: string) {
    await this.row(tx, businessId, reach, id); // 404 before taking the lock
    await tx.$executeRaw`SELECT 1 FROM intakes WHERE id = ${id}::uuid FOR UPDATE`;
    return this.row(tx, businessId, reach, id);
  }
}
