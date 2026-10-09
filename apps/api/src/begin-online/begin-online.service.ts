import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Database, Prisma, ScopedClient, TxClient } from '@firmivra/db';
import {
  BEGIN_ONLINE_FORM_ORDER,
  BeginDraft,
  type BeginContact,
  type BeginOnlineForm,
  type BeginOnlineFormItem,
  beginOnlinePrefill,
  checkIntakeAnswers,
  INTAKE_FORMS,
  INTAKE_UPLOAD_STATUS,
  IntakeFormDefinition,
  IntakeFormKey,
  type IntakeUpload,
  intakeStepFields,
  restoreMaskedNumbers,
  type SavedIntakeStep,
  type ScanStatus,
  type StartBeginDraftRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { beginOnlineService } from '../agreements/agreements.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { requestContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { maskStoredNumbers, sealIntakeNumbers } from '../intake/intake-numbers.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';
import {
  DraftCookies,
  draftErrors,
  formOfPath,
  holdDraft,
  notLive,
  renewDraft,
  rethrowExpired,
} from './drafts.js';

type Firm = { id: string; slug: string; name: string };
type Values = Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);
/** The year the firm prepares, fixed in a draft at its start (leads.tax_year). */
const currentTaxYear = () => new Date().getUTCFullYear();
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * New drafts a day (rolling 24 h), counted in the audit log like RESUME_LINK_LIMITS: per firm, and
 * per viewer IP on that firm's site (a firm's scope sees only its own rows; the in-memory
 * BEGIN_ONLINE_THROTTLE.start counts an IP across firms). Here, not next to BEGIN_ONLINE_THROTTLE
 * or RESUME_LINK_LIMITS, because both of those files import this one.
 */
export const DRAFT_START_LIMITS = { perFirm: 500, perIp: 50, windowMs: 24 * 60 * 60_000 };
const STARTED = 'begin_online.draft_started';

/** A lead upload row, as the draft's files are read. */
export interface LeadFile {
  id: string;
  slot: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  createdAt: Date;
}

/** A file of the draft as the visitor sees it (contract B's IntakeUpload). */
export const intakeUpload = (u: LeadFile): IntakeUpload => ({
  id: u.id,
  slot: u.slot,
  fileName: u.fileName,
  contentType: u.contentType,
  sizeBytes: u.sizeBytes,
  status: INTAKE_UPLOAD_STATUS[u.scanStatus],
  uploadedAt: u.createdAt.toISOString(),
});

export const LEAD_FILE_FIELDS = {
  id: true,
  slot: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  scanStatus: true,
  createdAt: true,
} as const;

/** A live draft: the lead, its service, form, open answers and files. */
export interface Draft {
  firm: Firm;
  form: IntakeFormKey;
  leadId: string;
  service: { id: string; kind: IntakeFormKey; name: string };
  contact: BeginContact;
  taxYear: number;
  draftExpiresAt: Date;
  updatedAt: Date;
  version: number;
  definition: IntakeFormDefinition;
  intakeId: string;
  submission: { id: string; answers: Values; savedSteps: string[] };
  uploads: LeadFile[];
}

/** How a draft is looked up: by the cookie's lead, or by a resume link's token hash. */
type DraftKey = { leadId: string } | { resumeTokenHash: string };

/**
 * Begin Online drafts (R11, contract B in packages/types/src/begin-online): public, on a firm's
 * portal site. The firm comes from the slug only (ACTIVE firms; else 404) and every query runs in
 * that firm's business scope. A draft is reached only through this browser's sealed cookie for
 * the service (DraftCookies: firm, lead and form) or a resume link's token (its SHA-256 in
 * leads.resume_token_hash). Audit rows hold ids and step keys only: never answers, names, emails
 * or tokens.
 */
@Injectable()
export class BeginOnlineService {
  private readonly logger = new Logger(BeginOnlineService.name);
  readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) env: Env,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly portal: PortalInfoService,
    private readonly fe: FieldEncryption,
    private readonly audit: AuditService,
    readonly cookies: DraftCookies,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  firm(slug: string): Promise<Firm> {
    return this.portal.activeFirm(slug);
  }

  /** The services the firm offers online (one per kind), in the page's order. */
  async forms(slug: string): Promise<BeginOnlineFormItem[]> {
    const firm = await this.firm(slug);
    const db = this.database.forBusiness(firm.id);
    const items: BeginOnlineFormItem[] = [];
    for (const form of BEGIN_ONLINE_FORM_ORDER) {
      const service = await this.liveService(firm.id, form).catch(() => null);
      const newest = service ? await this.newestForm(db, service).catch(() => null) : null;
      if (newest) items.push({ form, title: newest.definition.title, version: newest.version });
    }
    return items;
  }

  /** A service's form before a draft exists; 404 when the firm doesn't offer it online. */
  async form(slug: string, path: string): Promise<BeginOnlineForm> {
    const form = formOfPath(path);
    const firm = await this.firm(slug);
    const db = this.database.forBusiness(firm.id);
    const newest = await this.newestForm(db, await this.liveService(firm.id, form));
    return {
      form,
      version: newest.version,
      title: newest.definition.title,
      definition: newest.definition,
      taxYear: currentTaxYear(),
    };
  }

  /** Starts this browser's draft for the service (replacing an earlier one in this browser). */
  async start(
    slug: string,
    path: string,
    body: z.output<typeof StartBeginDraftRequest>,
    res: Response,
  ): Promise<BeginDraft> {
    const form = formOfPath(path);
    const firm = await this.firm(slug);
    const businessId = firm.id;
    const db = this.database.forBusiness(businessId);
    const service = await this.liveService(businessId, form);
    const newest = await this.newestForm(db, service);
    const { definition } = newest;
    const contact: BeginContact = {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email.toLowerCase(),
      phone: body.phone ?? null,
    };
    const ids = { lead: randomUUID(), intake: randomUUID(), submission: randomUUID() };
    // The form's own contact fields start filled in (each only when a save of its step takes it).
    const prefill = beginOnlinePrefill(definition, contact);
    const restored = restoreMaskedNumbers(definition, prefill, {});
    if (restored.issues.length) throw draftErrors.invalid(restored.issues);
    const where = { businessId, intakeId: ids.intake };
    const toStore = await sealIntakeNumbers(this.fe, where, definition, restored.answers, {});
    const taxYear = currentTaxYear();

    const lead = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await this.checkStartLimits(tx, businessId);
      if (newest.formId === null) {
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
      if (stored?.version !== newest.version) throw draftErrors.formChanged();
      // The database fills draft_expires_at (30 days from now); no resume link until one is asked.
      const row = await tx.lead.create({
        data: {
          id: ids.lead,
          businessId,
          serviceId: service.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          taxYear,
        },
        select: { draftExpiresAt: true, updatedAt: true },
      });
      if (!row.draftExpiresAt) throw new Error('A new draft has no expiry');
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
          savedSteps: [],
        },
      });
      await this.audit.logIn(
        tx,
        STARTED,
        { type: 'lead', id: ids.lead },
        { serviceId: service.id, form, formVersion: newest.version },
        { businessId },
      );
      return { draftExpiresAt: row.draftExpiresAt, updatedAt: row.updatedAt };
    });
    await this.cookies.write(res, firm, form, ids.lead, lead.draftExpiresAt, this.secure);
    return this.view({
      firm,
      form,
      leadId: ids.lead,
      service,
      contact,
      taxYear,
      draftExpiresAt: lead.draftExpiresAt,
      updatedAt: lead.updatedAt,
      version: newest.version,
      definition,
      intakeId: ids.intake,
      submission: { id: ids.submission, answers: toStore, savedSteps: [] },
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

  async get(slug: string, path: string, req: Request): Promise<BeginDraft> {
    return this.view(await this.draftOf(slug, path, req));
  }

  /** Autosave: the step's answers replace that step's (nothing is required until submit). */
  async saveStep(
    slug: string,
    path: string,
    stepKey: string,
    answers: Values,
    req: Request,
    res: Response,
  ): Promise<SavedIntakeStep> {
    const draft = await this.draftOf(slug, path, req);
    const saved = await this.saveAnswers(draft, stepKey, answers);
    await this.cookies.write(
      res,
      draft.firm,
      draft.form,
      draft.leadId,
      saved.draftExpiresAt,
      this.secure,
    );
    return { step: stepKey, savedAt: saved.updatedAt.toISOString() };
  }

  /** Saves one step of a draft (a save, or the review answers a submit carries). */
  async saveAnswers(draft: Draft, stepKey: string, answers: Values): Promise<Draft> {
    const { definition, firm } = draft;
    const checked = checkIntakeAnswers(definition, answers, {
      mode: 'save',
      step: stepKey,
      today: today(),
    });
    if (checked.issues.length) throw draftErrors.invalid(checked.issues);
    const stored = draft.submission.answers;
    const masked = await maskStoredNumbers(definition, stored);
    const restored = restoreMaskedNumbers(definition, checked.answers, masked);
    if (restored.issues.length) throw draftErrors.invalid(restored.issues);
    const where = { businessId: firm.id, intakeId: draft.intakeId };
    const toStore = await sealIntakeNumbers(this.fe, where, definition, restored.answers, stored);

    const step = definition.steps.find((s) => s.key === stepKey)!;
    const stepKeys = new Set(intakeStepFields(step).map((f) => f.key));
    const saved = await this.database
      .withScope({ kind: 'business', businessId: firm.id }, async (tx) => {
        await holdDraft(tx, draft.leadId);
        const renewed = await renewDraft(tx, draft.leadId);
        if (!renewed) throw draftErrors.expired();
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
        return { ...renewed, merged, savedSteps };
      })
      .catch(rethrowExpired);
    return {
      ...draft,
      draftExpiresAt: saved.expiresAt,
      updatedAt: saved.updatedAt,
      submission: { ...draft.submission, answers: saved.merged, savedSteps: saved.savedSteps },
    };
  }

  /**
   * This browser's draft for the service at this firm (its sealed cookie). 404 NOT_FOUND (no
   * cookie, another firm's or service's, a made-up one); 409 DRAFT_SUBMITTED once sent; 410
   * DRAFT_EXPIRED, after clearing a draft past its expiry and marking it EXPIRED.
   */
  async draftOf(slug: string, path: string, req: Request): Promise<Draft> {
    const form = formOfPath(path);
    const firm = await this.firm(slug);
    const claim = await this.cookies.read(req, firm, form);
    if (!claim) throw draftErrors.notFound();
    return this.loadDraft(firm, { leadId: claim.leadId }, form);
  }

  /**
   * The live draft a key opens at this firm. `form`: the service it must be (a cookie's); a
   * resume link opens whichever it is. A key that opens nothing is 404 for a cookie and 410
   * DRAFT_EXPIRED for a link (one answer for unknown, replaced and expired links).
   */
  async loadDraft(firm: Firm, key: DraftKey, form?: IntakeFormKey): Promise<Draft> {
    const byLink = 'resumeTokenHash' in key;
    const missing = () => (byLink ? draftErrors.expired() : draftErrors.notFound());
    const lead = await this.database.forBusiness(firm.id).lead.findUnique({
      where: byLink ? { resumeTokenHash: key.resumeTokenHash } : { id: key.leadId },
      select: {
        id: true,
        status: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        taxYear: true,
        draftExpiresAt: true,
        resumeExpiresAt: true,
        updatedAt: true,
        service: { select: { id: true, kind: true, name: true } },
        uploads: { orderBy: { createdAt: 'asc' }, select: LEAD_FILE_FIELDS },
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
    const kind = IntakeFormKey.safeParse(lead?.service.kind);
    if (!lead || !kind.success || (form && kind.data !== form)) throw missing();
    if (lead.status !== 'DRAFT') throw notLive(lead.status);
    if (!lead.draftExpiresAt || lead.draftExpiresAt <= new Date()) {
      await this.expire(firm.id, lead.id);
      throw draftErrors.expired();
    }
    if (byLink && (!lead.resumeExpiresAt || lead.resumeExpiresAt <= new Date())) throw missing();
    const intake = lead.intakes[0];
    const submission = intake?.submissions[0];
    if (!intake || !submission) throw missing();
    const definition = readDefinition(intake.form.definition, kind.data, intake.form.version);
    return {
      firm,
      form: kind.data,
      leadId: lead.id,
      service: { ...lead.service, kind: kind.data },
      contact: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
      },
      taxYear: lead.taxYear ?? currentTaxYear(),
      draftExpiresAt: lead.draftExpiresAt,
      updatedAt: lead.updatedAt,
      version: intake.form.version,
      definition,
      intakeId: intake.id,
      submission: { ...submission, answers: submission.answers as Values },
      uploads: lead.uploads,
    };
  }

  /** The draft as the visitor sees it (contract B's BeginDraft: numbers as `{ last4 }`). */
  async view(draft: Draft): Promise<BeginDraft> {
    const saved = new Set(draft.submission.savedSteps);
    return BeginDraft.parse({
      form: draft.form,
      version: draft.version,
      title: draft.definition.title,
      definition: draft.definition,
      taxYear: draft.taxYear,
      contact: draft.contact,
      answers: await maskStoredNumbers(draft.definition, draft.submission.answers),
      uploads: draft.uploads.map(intakeUpload),
      savedSteps: draft.definition.steps.map((s) => s.key).filter((k) => saved.has(k)),
      expiresAt: draft.draftExpiresAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    });
  }

  /**
   * A draft past its expiry: its answers are cleared and its uploads deleted while it is still a
   * draft (R0 allows only that), then it and its intake become EXPIRED and its resume link is
   * cleared. After commit the stored files are deleted.
   */
  private async expire(businessId: string, leadId: string): Promise<void> {
    const keys = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM leads
         WHERE id = ${leadId}::uuid AND status = 'DRAFT' AND draft_expires_at <= now()
           FOR UPDATE`;
      if (rows.length === 0) return [];
      const files = await tx.leadUpload.findMany({ where: { leadId }, select: { s3Key: true } });
      await tx.leadUpload.deleteMany({ where: { leadId } });
      await tx.intakeSubmission.updateMany({
        where: { intake: { leadId }, submittedAt: null },
        data: { answers: {}, savedSteps: [] },
      });
      await tx.intake.updateMany({
        where: { leadId, status: 'IN_PROGRESS' },
        data: { status: 'EXPIRED' },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { status: 'EXPIRED', resumeTokenHash: null, resumeExpiresAt: null },
      });
      await this.audit.logIn(
        tx,
        'begin_online.draft_expired',
        { type: 'lead', id: leadId },
        { removed: files.length },
        { businessId },
      );
      return files.map((f) => f.s3Key);
    });
    for (const key of keys) {
      await this.storage.remove(key).catch((error: unknown) => {
        this.logger.warn(`Could not delete an expired draft's file: ${nameOf(error)}`);
      });
    }
  }

  /**
   * The firm's Begin Online service of the kind, or 404: resolved only through R14's
   * `beginOnlineService` (the lookup the agreement block uses, so the agreements a submit signs
   * are the block's), and offered only while it is marked Begin Online (services.begin_online).
   */
  async liveService(businessId: string, form: IntakeFormKey) {
    return this.database.withScope({ kind: 'business', businessId }, (tx) => serviceFor(tx, form));
  }

  /** The newest published version, else the built-in form as version 1 (nothing is written). */
  private async newestForm(db: ScopedClient, service: { id: string; kind: IntakeFormKey }) {
    const row = await db.intakeForm.findFirst({
      where: { serviceId: service.id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, definition: true },
    });
    if (row) {
      const definition = readDefinition(row.definition, service.kind, row.version);
      return { formId: row.id as string | null, version: row.version, definition };
    }
    const builtIn = INTAKE_FORMS[service.kind];
    if (!builtIn) throw draftErrors.notFound();
    return { formId: null, version: 1, definition: { ...builtIn, version: 1 } };
  }
}

/** A stored definition, with its kind and version from the columns (the contract's rule). */
function readDefinition(json: unknown, kind: IntakeFormKey, version: number): IntakeFormDefinition {
  return IntakeFormDefinition.parse({ ...(json as object), key: kind, version });
}

/** The Begin Online service of a form, in a transaction of the firm (see `liveService`). */
export async function serviceFor(tx: TxClient, form: IntakeFormKey) {
  const { id } = await beginOnlineService(tx, form);
  const service = await tx.service.findFirst({
    where: { id, beginOnline: true, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!service) throw draftErrors.notFound();
  return { ...service, kind: form };
}
