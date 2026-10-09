import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Database, Prisma, ScopedClient, TxClient } from '@firmivra/db';
import {
  BeginDraft,
  DraftUpload,
  type ScanStatus,
  beginOnlineContact,
  type BeginOnlineForm,
  type BeginOnlineService as ServiceCard,
  beginOnlineTaxYear,
  checkIntakeAnswers,
  INTAKE_FORMS,
  IntakeFormDefinition,
  type IntakeFormKey,
  intakeStepFields,
  restoreMaskedNumbers,
  type StartDraftRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { maskStoredNumbers, sealIntakeNumbers } from '../intake/intake-numbers.js';
import {
  draftErrors,
  draftTokenOf,
  hashToken,
  newDraftToken,
  renewDraft,
  writeDraftCookie,
} from './drafts.js';

type Firm = { id: string; slug: string; name: string };
type Values = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * New drafts a day (rolling 24 h), counted in the audit log like RESUME_LINK_LIMITS: per firm, and
 * per viewer IP on that firm's site (a firm's scope sees only its own rows; the in-memory
 * BEGIN_ONLINE_THROTTLE.start counts an IP across firms). Here, not next to BEGIN_ONLINE_THROTTLE
 * or RESUME_LINK_LIMITS, because both of those files import this one.
 */
export const DRAFT_START_LIMITS = { perFirm: 500, perIp: 50, windowMs: 24 * 60 * 60_000 };
const STARTED = 'begin_online.draft_started';

/** A live draft, found by its key: the lead, its service, form and open answers. */
export interface Draft {
  firm: Firm;
  hash: string;
  leadId: string;
  service: { id: string; kind: IntakeFormKey; name: string };
  taxYear: number | null;
  draftExpiresAt: Date;
  definition: IntakeFormDefinition;
  intakeId: string;
  submission: { id: string; answers: Values; savedSteps: string[] };
  uploads: DraftUpload[];
}

const UPLOAD_FIELDS = {
  id: true,
  slot: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  scanStatus: true,
  createdAt: true,
} as const;
/** A lead upload as the visitor sees it. */
export const draftUpload = (u: {
  id: string;
  slot: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  createdAt: Date;
}): DraftUpload => DraftUpload.parse({ ...u, createdAt: u.createdAt.toISOString() });

/**
 * Begin Online drafts (R11 step 3): public, on a firm's portal site. The firm comes from the slug
 * only (ACTIVE firms; else 404) and every query runs in that firm's business scope. A draft is
 * reached only through its key (the cookie): its SHA-256 is looked up in leads.resume_token_hash
 * within the firm. Audit rows hold ids and step keys only: never answers, names, emails or keys.
 */
@Injectable()
export class BeginOnlineService {
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) env: Env,
    private readonly portal: PortalInfoService,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  async services(slug: string): Promise<ServiceCard[]> {
    const firm = await this.portal.activeFirm(slug);
    const rows = await this.database.forBusiness(firm.id).service.findMany({
      where: { beginOnline: true, archivedAt: null, kind: { not: 'OTHER' } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, kind: true, name: true, description: true, packages: true },
    });
    return rows.map((r) => ({ ...r, kind: r.kind as IntakeFormKey }));
  }

  async form(slug: string, serviceId: string): Promise<BeginOnlineForm> {
    const firm = await this.portal.activeFirm(slug);
    const db = this.database.forBusiness(firm.id);
    return this.newestForm(db, await this.liveService(db, serviceId));
  }

  async start(slug: string, body: StartDraftRequest, res: Response): Promise<BeginDraft> {
    const firm = await this.portal.activeFirm(slug);
    const businessId = firm.id;
    const db = this.database.forBusiness(businessId);
    const service = await this.liveService(db, body.serviceId);
    const form = await this.newestForm(db, service);
    const { definition } = form;
    if (body.step !== definition.steps[0]?.key) {
      const issue = { step: body.step, path: [], label: '', message: 'Start with the first step' };
      throw draftErrors.invalid([issue]);
    }
    const checked = checkIntakeAnswers(definition, body.answers, {
      mode: 'save',
      step: body.step,
      today: today(),
    });
    const { issues, contact } = beginOnlineContact(definition, checked.answers);
    if (checked.issues.length || issues.length) {
      throw draftErrors.invalid([...checked.issues, ...issues]);
    }
    const ids = { lead: randomUUID(), intake: randomUUID(), submission: randomUUID() };
    const restored = restoreMaskedNumbers(definition, checked.answers, {});
    if (restored.issues.length) throw draftErrors.invalid(restored.issues);
    const where = { businessId, intakeId: ids.intake };
    const toStore = await sealIntakeNumbers(this.fe, where, definition, restored.answers, {});

    const { token, hash } = newDraftToken();
    const draftExpiresAt = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        await this.checkStartLimits(tx, businessId);
        if (form.formId === null) {
          // The built-in form becomes the firm's version 1 (a parallel start inserts nothing).
          await tx.intakeForm.createMany({
            data: [
              {
                businessId,
                serviceId: service.id,
                version: 1,
                title: definition.title,
                definition: definition as unknown as Prisma.InputJsonValue,
                status: 'PUBLISHED',
                publishedAt: new Date(),
              },
            ],
            skipDuplicates: true,
          });
        }
        const stored = await tx.intakeForm.findFirst({
          where: { serviceId: service.id, status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
        if (stored?.version !== form.version) throw draftErrors.formChanged();
        await tx.lead.create({
          data: {
            id: ids.lead,
            businessId,
            serviceId: service.id,
            ...contact,
            email: contact.email.toLowerCase(),
            taxYear: beginOnlineTaxYear(definition, today()),
            resumeTokenHash: hash,
            resumeExpiresAt: new Date(), // set by renewDraft below, in the database's clock
          },
        });
        const expiresAt = await renewDraft(tx, ids.lead, hash);
        if (!expiresAt) throw new Error('A new draft could not be renewed');
        await tx.intake.create({
          data: {
            id: ids.intake,
            businessId,
            formId: stored.id,
            leadId: ids.lead,
            status: 'IN_PROGRESS',
          },
        });
        await tx.intakeSubmission.create({
          data: {
            id: ids.submission,
            businessId,
            intakeId: ids.intake,
            version: 1,
            answers: toStore as Prisma.InputJsonValue,
            savedSteps: [body.step],
          },
        });
        await this.audit.logIn(
          tx,
          STARTED,
          { type: 'lead', id: ids.lead },
          { serviceId: service.id, formVersion: form.version, step: body.step },
          { businessId },
        );
        return expiresAt;
      },
    );
    writeDraftCookie(res, firm.slug, token, draftExpiresAt, this.secure);
    return this.view({
      firm,
      hash,
      leadId: ids.lead,
      service,
      taxYear: beginOnlineTaxYear(definition, today()),
      draftExpiresAt,
      definition,
      intakeId: ids.intake,
      submission: { id: ids.submission, answers: toStore, savedSteps: [body.step] },
      uploads: [],
    });
  }

  /**
   * 429 RATE_LIMITED past either start limit, before the lead is written (so no lead, no cookie).
   * Retry-After is when enough counted rows leave the window to allow one more (the global filter
   * caps it at an hour). Starts of one firm count one after the other, under a lock.
   */
  private async checkStartLimits(tx: TxClient, businessId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`begin-online-start:${businessId}`}, 0))`;
    const { perFirm, perIp, windowMs } = DRAFT_START_LIMITS;
    const firmWide = { action: STARTED, createdAt: { gt: new Date(Date.now() - windowMs) } };
    const ip = requestContext.getStore()?.ip;
    const limits: [Prisma.AuditLogWhereInput, number][] = [[firmWide, perFirm]];
    if (ip) limits.push([{ ...firmWide, ip }, perIp]);
    for (const [where, max] of limits) {
      const count = await tx.auditLog.count({ where });
      if (count < max) continue;
      const leaving = await tx.auditLog.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        skip: count - max,
        select: { createdAt: true },
      });
      const freeAt = (leaving?.createdAt.getTime() ?? Date.now()) + windowMs;
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many forms were started. Please try again later.',
          retryAfter: Math.max(1, Math.ceil((freeAt - Date.now()) / 1000)),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async current(slug: string, req: Request): Promise<BeginDraft> {
    return this.view(await this.draftOf(slug, req));
  }

  /** Autosave: the step's answers replace that step's; the first step also updates the contact. */
  async saveStep(
    slug: string,
    stepKey: string,
    answers: Values,
    req: Request,
  ): Promise<BeginDraft> {
    const draft = await this.draftOf(slug, req);
    const { definition, firm } = draft;
    const checked = checkIntakeAnswers(definition, answers, {
      mode: 'save',
      step: stepKey,
      today: today(),
    });
    if (checked.issues.length) throw draftErrors.invalid(checked.issues);
    const first = definition.steps[0]?.key === stepKey;
    const { issues, contact } = beginOnlineContact(definition, checked.answers);
    if (first && issues.length) throw draftErrors.invalid(issues);
    const stored = draft.submission.answers;
    const masked = await maskStoredNumbers(definition, stored);
    const restored = restoreMaskedNumbers(definition, checked.answers, masked);
    if (restored.issues.length) throw draftErrors.invalid(restored.issues);
    const where = { businessId: firm.id, intakeId: draft.intakeId };
    const toStore = await sealIntakeNumbers(this.fe, where, definition, restored.answers, stored);

    const step = definition.steps.find((s) => s.key === stepKey)!;
    const stepKeys = new Set(intakeStepFields(step).map((f) => f.key));
    const saved = await this.database.withScope(
      { kind: 'business', businessId: firm.id },
      async (tx) => {
        const expiresAt = await renewDraft(tx, draft.leadId, draft.hash);
        if (!expiresAt) throw draftErrors.noDraft();
        if (first) {
          await tx.lead.update({
            where: { id: draft.leadId },
            data: { ...contact, email: contact.email.toLowerCase() },
          });
        }
        // Read again under the lead's lock: a parallel save of another step is kept.
        const row = await tx.intakeSubmission.findUniqueOrThrow({
          where: { id: draft.submission.id },
          select: { answers: true, savedSteps: true },
        });
        const kept = Object.entries(row.answers as Values).filter(([k]) => !stepKeys.has(k));
        const merged = { ...Object.fromEntries(kept), ...toStore };
        const savedSteps = row.savedSteps.includes(stepKey)
          ? row.savedSteps
          : [...row.savedSteps, stepKey];
        await tx.intakeSubmission.update({
          where: { id: draft.submission.id },
          data: { answers: merged as Prisma.InputJsonValue, savedSteps },
        });
        await this.audit.logIn(
          tx,
          'begin_online.step_saved',
          { type: 'lead', id: draft.leadId },
          { serviceId: draft.service.id, step: stepKey },
          { businessId: firm.id },
        );
        return { expiresAt, merged, savedSteps };
      },
    );
    return this.view({
      ...draft,
      draftExpiresAt: saved.expiresAt,
      submission: { ...draft.submission, answers: saved.merged, savedSteps: saved.savedSteps },
    });
  }

  /**
   * The live draft this browser's key opens at this firm. 404 DRAFT_NOT_FOUND (no key, a
   * replaced key, another firm's, a sent draft); 410 DRAFT_EXPIRED, after turning a draft past
   * its expiry into EXPIRED (its intake too).
   */
  async draftOf(slug: string, req: Request): Promise<Draft> {
    const firm = await this.portal.activeFirm(slug);
    const token = draftTokenOf(req, firm.slug);
    if (!token) throw draftErrors.noDraft();
    return this.draftByHash(firm, hashToken(token));
  }

  async draftByHash(firm: Firm, hash: string): Promise<Draft> {
    const lead = await this.database.forBusiness(firm.id).lead.findUnique({
      where: { resumeTokenHash: hash },
      select: {
        id: true,
        status: true,
        taxYear: true,
        draftExpiresAt: true,
        resumeExpiresAt: true,
        service: { select: { id: true, kind: true, name: true } },
        uploads: { orderBy: { createdAt: 'asc' }, select: UPLOAD_FIELDS },
        intakes: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            id: true,
            form: { select: { version: true, definition: true } },
            submissions: {
              where: { submittedAt: null },
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true, answers: true, savedSteps: true },
            },
          },
        },
      },
    });
    if (lead?.status === 'EXPIRED') throw draftErrors.expired();
    const intake = lead?.intakes[0];
    const submission = intake?.submissions[0];
    if (lead?.status !== 'DRAFT' || !intake || !submission || !lead.draftExpiresAt) {
      throw draftErrors.noDraft();
    }
    if (lead.draftExpiresAt <= new Date()) {
      await this.expire(firm.id, lead.id);
      throw draftErrors.expired();
    }
    if (!lead.resumeExpiresAt || lead.resumeExpiresAt <= new Date()) throw draftErrors.noDraft();
    const kind = lead.service.kind as IntakeFormKey;
    return {
      firm,
      hash,
      leadId: lead.id,
      service: { ...lead.service, kind },
      taxYear: lead.taxYear,
      draftExpiresAt: lead.draftExpiresAt,
      definition: readDefinition(intake.form.definition, kind, intake.form.version),
      intakeId: intake.id,
      submission: { ...submission, answers: submission.answers as Values },
      uploads: lead.uploads.map(draftUpload),
    };
  }

  async view(draft: Draft): Promise<BeginDraft> {
    return BeginDraft.parse({
      leadId: draft.leadId,
      service: draft.service,
      definition: draft.definition,
      taxYear: draft.taxYear,
      answers: await maskStoredNumbers(draft.definition, draft.submission.answers),
      savedSteps: draft.submission.savedSteps,
      draftExpiresAt: draft.draftExpiresAt.toISOString(),
      uploads: draft.uploads,
    });
  }

  /** A draft past its expiry only becomes EXPIRED (the database allows nothing else). */
  private async expire(businessId: string, leadId: string): Promise<void> {
    await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const done = await tx.lead.updateMany({
        where: { id: leadId, status: 'DRAFT', draftExpiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      if (done.count === 0) return;
      await tx.intake.updateMany({
        where: { leadId, status: 'IN_PROGRESS' },
        data: { status: 'EXPIRED' },
      });
      await this.audit.logIn(
        tx,
        'begin_online.draft_expired',
        { type: 'lead', id: leadId },
        {},
        {
          businessId,
        },
      );
    });
  }

  /** A live Begin Online service of the firm, or 404. */
  private async liveService(db: ScopedClient, serviceId: string) {
    const service = UUID.test(serviceId)
      ? await db.service.findFirst({
          where: { id: serviceId, beginOnline: true, archivedAt: null, kind: { not: 'OTHER' } },
          select: { id: true, kind: true, name: true },
        })
      : null;
    if (!service) throw draftErrors.notFound();
    return { ...service, kind: service.kind as IntakeFormKey };
  }

  /** The newest published version, else the built-in form as version 1 (nothing is written). */
  private async newestForm(
    db: ScopedClient,
    service: { id: string; kind: IntakeFormKey },
  ): Promise<BeginOnlineForm> {
    const row = await db.intakeForm.findFirst({
      where: { serviceId: service.id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, definition: true },
    });
    if (row) {
      const definition = readDefinition(row.definition, service.kind, row.version);
      return { formId: row.id, version: row.version, definition };
    }
    const builtIn = INTAKE_FORMS[service.kind];
    if (!builtIn) throw draftErrors.notFound();
    return { formId: null, version: 1, definition: builtIn };
  }
}

/** A stored definition, with its kind and version from the columns (the contract's rule). */
function readDefinition(json: unknown, kind: IntakeFormKey, version: number): IntakeFormDefinition {
  return IntakeFormDefinition.parse({ ...(json as object), key: kind, version });
}
