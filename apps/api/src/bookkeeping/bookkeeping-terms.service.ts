import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { databaseErrorCode, type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  ActivateBookkeepingTermsRequest,
  BookkeepingPaymentSchedule,
  BookkeepingPaymentScheduleQuery,
  BookkeepingTerms,
  BookkeepingTermsEvent,
  BookkeepingTermsEventKind,
  BookkeepingTermsHistory,
  BookkeepingTermsHistoryQuery,
  BookkeepingTermsNoticeRequest,
  BookkeepingTermsPage,
  CreateBookkeepingTermsRequest,
  SendBookkeepingTermsRequest,
  SetBookkeepingTermsAgreementRequest,
  TerminateBookkeepingTermsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  type BookkeepingActor,
  findProfile,
  isManager,
  reachEngagement,
} from './bookkeeping.mappers.js';
import { bookkeepingDbMessage, day, errors, inFirm, toDay } from './bookkeeping.shared.js';

type Out<S extends z.ZodType> = z.output<S>;
type Fields = Out<typeof CreateBookkeepingTermsRequest>;

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const termsState = (message = 'These terms are not in a state that allows this') =>
  conflict('TERMS_STATE', message);
const notSigned = () =>
  conflict('AGREEMENT_NOT_SIGNED', 'Add the signed agreement or the e-signature first');

const DATE_KEYS = ['startDate', 'endDate', 'renewalDate', 'effectiveFrom'] as const;
const JSON_KEYS = [
  'additionalBilling',
  'lateFeeRule',
  'discounts',
  'includedServices',
  'excludedServices',
  'addOns',
  'deliverables',
  'clientResponsibilities',
  'firmResponsibilities',
] as const;
const PLAIN_KEYS = [
  'packageName',
  'renewalType',
  'noticeDays',
  'billingFrequency',
  'billingTiming',
  'paymentTerms',
  'paymentTermsDays',
  'preferredPaymentMethod',
  'autopay',
  'monthlyFeeCents',
  'setupFeeCents',
] as const;
const TERMS_KEYS = [...DATE_KEYS, ...JSON_KEYS, ...PLAIN_KEYS];

/** Which History event a changed field belongs to. */
const EVENT_OF: Record<string, BookkeepingTermsEventKind> = {
  packageName: 'PACKAGE_CHANGED',
  monthlyFeeCents: 'PRICING_CHANGED',
  setupFeeCents: 'PRICING_CHANGED',
  additionalBilling: 'PRICING_CHANGED',
  lateFeeRule: 'PRICING_CHANGED',
  discounts: 'PRICING_CHANGED',
  billingFrequency: 'PRICING_CHANGED',
  billingTiming: 'PRICING_CHANGED',
  paymentTerms: 'PRICING_CHANGED',
  paymentTermsDays: 'PRICING_CHANGED',
  preferredPaymentMethod: 'PRICING_CHANGED',
  autopay: 'PRICING_CHANGED',
  includedServices: 'SCOPE_CHANGED',
  excludedServices: 'SCOPE_CHANGED',
  addOns: 'SCOPE_CHANGED',
  deliverables: 'SCOPE_CHANGED',
  clientResponsibilities: 'SCOPE_CHANGED',
  firmResponsibilities: 'SCOPE_CHANGED',
  startDate: 'RENEWAL_CHANGED',
  endDate: 'RENEWAL_CHANGED',
  renewalType: 'RENEWAL_CHANGED',
  renewalDate: 'RENEWAL_CHANGED',
  noticeDays: 'RENEWAL_CHANGED',
  effectiveFrom: 'RENEWAL_CHANGED',
};

const termsInclude = {
  agreement: { select: { id: true, fileName: true } },
  signedAgreement: { select: { id: true, fileName: true } },
  esignRequest: { select: { id: true, title: true, status: true } },
} satisfies Prisma.BookkeepingTermsInclude;
type TermsRow = Prisma.BookkeepingTermsGetPayload<{ include: typeof termsInclude }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const OPEN = ['DRAFT', 'SENT'] as const;

/** A short value for the History: plain values as they are, lists and rules as "changed". */
const shortValue = (key: string, v: unknown) =>
  (JSON_KEYS as readonly string[]).includes(key) ? undefined : v instanceof Date ? day(v) : v;

/** The month a row of the Payment Schedule bills: "September 2026". */
const monthName = (d: Date) =>
  d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The cursor of a History page: the last row's time and id. */
const encode = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decode(cursor?: string): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const when = new Date(at ?? '');
  if (!id || Number.isNaN(when.getTime()) || !/^[0-9a-f-]{36}$/i.test(id))
    throw errors.invalid('cursor', 'Start from the first page');
  return { at: when, id };
}

/**
 * A bookkeeping client's engagement terms (R55; contract in packages/types/src/bookkeeping/terms.ts,
 * tables from R0 stage C1). Everyone who reaches the client reads; Owner and Admin change (the
 * routes' roles, checked again here). The database numbers versions, refuses an edit of terms that
 * are no longer a draft and supersedes the version before on activation; the API adds one open
 * draft per client and the History events. Audit rows hold ids, field names and statuses only.
 */
@Injectable()
export class BookkeepingTermsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private assertManager(actor: BookkeepingActor) {
    if (!isManager(actor)) throw errors.forbidden();
  }

  /** The database's refusals as the contract's errors, never a 500. */
  private mapError(e: unknown): never {
    const rule = bookkeepingDbMessage(e);
    if (rule && /terms/.test(rule)) throw termsState();
    const code = databaseErrorCode(e) ?? (e as { code?: string } | null)?.code;
    if (code === 'P2003' || code === '23503') throw errors.notThisClients('document or request');
    if (code === '23514')
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Some of the values are not allowed',
      });
    throw e;
  }

  private async run<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await inFirm(this.database, businessId, fn);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      return this.mapError(e);
    }
  }

  /** One version the caller reaches (its client's reach), with its client's bookkeeping id. */
  private async findTerms(
    tx: TxClient,
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
  ) {
    const row = await tx.bookkeepingTerms.findFirst({
      where: { businessId, id: termsId, engagement: reachEngagement(actor) },
      include: termsInclude,
    });
    if (!row) throw errors.notFound();
    const profile = await tx.bookkeepingProfile.findFirst({
      where: { businessId, engagementId: row.engagementId },
      select: { id: true },
    });
    if (!profile) throw errors.notFound();
    return { row, profileId: profile.id };
  }

  private async names(tx: TxClient, businessId: string, ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map<string, string>();
    const rows = await tx.membership.findMany({
      where: { businessId, userId: { in: wanted } },
      select: { userId: true, user: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.userId, r.user.name]));
  }

  private view(
    row: TermsRow,
    profileId: string,
    actor: BookkeepingActor,
    names: Map<string, string>,
    openDraft: boolean,
  ): BookkeepingTerms {
    const manager = isManager(actor);
    const s = row.status;
    return {
      id: row.id,
      bookkeepingClientId: profileId,
      version: row.version,
      status: s,
      packageName: row.packageName,
      startDate: day(row.startDate) as string,
      endDate: day(row.endDate),
      renewalType: row.renewalType,
      renewalDate: day(row.renewalDate),
      noticeDays: row.noticeDays,
      effectiveFrom: day(row.effectiveFrom) as string,
      billingFrequency: row.billingFrequency,
      billingTiming: row.billingTiming,
      paymentTerms: row.paymentTerms,
      paymentTermsDays: row.paymentTermsDays,
      preferredPaymentMethod: row.preferredPaymentMethod,
      autopay: row.autopay,
      monthlyFeeCents: row.monthlyFeeCents,
      setupFeeCents: row.setupFeeCents,
      additionalBilling: row.additionalBilling as BookkeepingTerms['additionalBilling'],
      lateFeeRule: row.lateFeeRule as BookkeepingTerms['lateFeeRule'],
      discounts: row.discounts as BookkeepingTerms['discounts'],
      includedServices: row.includedServices as string[],
      excludedServices: row.excludedServices as string[],
      addOns: row.addOns as BookkeepingTerms['addOns'],
      deliverables: row.deliverables as BookkeepingTerms['deliverables'],
      clientResponsibilities: row.clientResponsibilities as string[],
      firmResponsibilities: row.firmResponsibilities as string[],
      internalNotes: manager ? row.internalNotes : null,
      documents: {
        agreement: row.agreement ? { id: row.agreement.id, name: row.agreement.fileName } : null,
        signedAgreement: row.signedAgreement
          ? { id: row.signedAgreement.id, name: row.signedAgreement.fileName }
          : null,
        esignRequest: row.esignRequest,
        signedAt: iso(row.signedAt),
      },
      sentAt: iso(row.sentAt),
      activatedAt: iso(row.activatedAt),
      supersededAt: iso(row.supersededAt),
      terminatedAt: iso(row.terminatedAt),
      terminationReason: row.terminationReason,
      createdBy: row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      can: {
        edit: manager && s === 'DRAFT',
        send: manager && s === 'DRAFT',
        backToDraft: manager && s === 'SENT',
        activate: manager && (s === 'DRAFT' || s === 'SENT'),
        terminate: manager && s === 'ACTIVE',
        newVersion: manager && s === 'ACTIVE' && !openDraft,
      },
    };
  }

  private async one(tx: TxClient, businessId: string, actor: BookkeepingActor, termsId: string) {
    const { row, profileId } = await this.findTerms(tx, businessId, actor, termsId);
    const open = await tx.bookkeepingTerms.count({
      where: { businessId, engagementId: row.engagementId, status: { in: [...OPEN] } },
    });
    return this.view(
      row,
      profileId,
      actor,
      await this.names(tx, businessId, [row.createdByUserId]),
      open > 0,
    );
  }

  private event(
    tx: TxClient,
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    kind: BookkeepingTermsEventKind,
    extra: {
      effectiveDate?: string | null;
      noticeSentAt?: string | null;
      reason?: string | null;
      details?: Record<string, unknown>;
    } = {},
  ) {
    return tx.bookkeepingTermsEvent.create({
      data: {
        businessId,
        termsId,
        kind,
        effectiveDate: extra.effectiveDate ? toDay(extra.effectiveDate) : null,
        noticeSentAt: extra.noticeSentAt ? new Date(extra.noticeSentAt) : null,
        reason: extra.reason ?? null,
        details: (extra.details ?? {}) as Prisma.InputJsonValue,
        actorUserId: actor.userId,
      },
      select: { id: true },
    });
  }

  /** The columns a request sets (undefined: unchanged; null: cleared). */
  private data(body: Partial<Fields>): Prisma.BookkeepingTermsUncheckedUpdateInput {
    const data: Record<string, unknown> = {};
    for (const k of DATE_KEYS) {
      const v = body[k];
      if (v !== undefined) data[k] = v === null ? null : toDay(v);
    }
    for (const k of JSON_KEYS) {
      const v = body[k];
      if (v !== undefined) data[k] = v === null ? (k === 'lateFeeRule' ? Prisma.DbNull : []) : v;
    }
    for (const k of PLAIN_KEYS) if (body[k] !== undefined) data[k] = body[k];
    // Only CUSTOM payment terms keep their days.
    if (body.paymentTerms && body.paymentTerms !== 'CUSTOM') data.paymentTermsDays = null;
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes;
    return data as Prisma.BookkeepingTermsUncheckedUpdateInput;
  }

  // ---------- Reads ----------

  page(businessId: string, actor: BookkeepingActor, id: string): Promise<BookkeepingTermsPage> {
    return this.run(businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const rows = await tx.bookkeepingTerms.findMany({
        where: { businessId, engagementId: p.engagementId },
        include: termsInclude,
        orderBy: { version: 'desc' },
      });
      const names = await this.names(
        tx,
        businessId,
        rows.map((r) => r.createdByUserId),
      );
      const open = rows.some((r) => (OPEN as readonly string[]).includes(r.status));
      const current = rows.find((r) => r.status === 'ACTIVE');
      const draft = rows.find((r) => (OPEN as readonly string[]).includes(r.status));
      return {
        bookkeepingClientId: p.id,
        current: current ? this.view(current, p.id, actor, names, open) : null,
        draft: draft ? this.view(draft, p.id, actor, names, open) : null,
        versions: rows.map((r) => ({
          id: r.id,
          version: r.version,
          status: r.status,
          packageName: r.packageName,
          monthlyFeeCents: r.monthlyFeeCents,
          effectiveFrom: day(r.effectiveFrom) as string,
          activatedAt: iso(r.activatedAt),
          supersededAt: iso(r.supersededAt),
          terminatedAt: iso(r.terminatedAt),
        })),
      };
    });
  }

  get(businessId: string, actor: BookkeepingActor, termsId: string): Promise<BookkeepingTerms> {
    return this.run(businessId, (tx) => this.one(tx, businessId, actor, termsId));
  }

  // ---------- Changes ----------

  /**
   * New Terms: a DRAFT. Left-out fields come from the version in force, else from the client's
   * package and the defaults. One open draft per client (409 TERMS_DRAFT_EXISTS).
   */
  create(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: Fields,
  ): Promise<BookkeepingTerms> {
    this.assertManager(actor);
    return this.run(businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const engagementId = p.engagementId;
      // One at a time per client, so two clicks never make two drafts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bookkeeping_terms:${engagementId}`}))`;
      const open = await tx.bookkeepingTerms.count({
        where: { businessId, engagementId, status: { in: [...OPEN] } },
      });
      if (open)
        throw conflict(
          'TERMS_DRAFT_EXISTS',
          'This client already has draft terms: edit that version',
        );
      const current = await tx.bookkeepingTerms.findFirst({
        where: { businessId, engagementId, status: 'ACTIVE' },
      });
      const today = new Date().toISOString().slice(0, 10);
      const base: Prisma.BookkeepingTermsUncheckedCreateInput = current
        ? {
            businessId,
            engagementId,
            version: 0,
            packageName: current.packageName,
            startDate: current.startDate,
            endDate: current.endDate,
            renewalType: current.renewalType,
            renewalDate: current.renewalDate,
            noticeDays: current.noticeDays,
            billingFrequency: current.billingFrequency,
            billingTiming: current.billingTiming,
            paymentTerms: current.paymentTerms,
            paymentTermsDays: current.paymentTermsDays,
            preferredPaymentMethod: current.preferredPaymentMethod,
            autopay: current.autopay,
            monthlyFeeCents: current.monthlyFeeCents,
            setupFeeCents: current.setupFeeCents,
            additionalBilling: current.additionalBilling as Prisma.InputJsonValue,
            lateFeeRule: (current.lateFeeRule ?? undefined) as Prisma.InputJsonValue | undefined,
            discounts: current.discounts as Prisma.InputJsonValue,
            includedServices: current.includedServices as Prisma.InputJsonValue,
            excludedServices: current.excludedServices as Prisma.InputJsonValue,
            addOns: current.addOns as Prisma.InputJsonValue,
            deliverables: current.deliverables as Prisma.InputJsonValue,
            clientResponsibilities: current.clientResponsibilities as Prisma.InputJsonValue,
            firmResponsibilities: current.firmResponsibilities as Prisma.InputJsonValue,
            effectiveFrom: toDay(today),
            internalNotes: current.internalNotes,
          }
        : {
            businessId,
            engagementId,
            version: 0,
            packageName: p.engagement.package?.slice(0, 120) ?? null,
            startDate: toDay(today),
            effectiveFrom: toDay(today),
          };
      const row = await tx.bookkeepingTerms.create({
        data: {
          ...base,
          ...(this.data(body) as Prisma.BookkeepingTermsUncheckedCreateInput),
          ...(body.startDate && !body.effectiveFrom && !current
            ? { effectiveFrom: toDay(body.startDate) }
            : {}),
          createdByUserId: actor.userId,
        },
        select: { id: true, version: true },
      });
      await this.event(tx, businessId, actor, row.id, 'CREATED', {
        details: { version: row.version, fromVersion: current?.version ?? null },
      });
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.created',
        { type: 'bookkeeping_terms', id: row.id },
        {
          engagementId,
          version: row.version,
          fromTermsId: current?.id ?? null,
          fields: TERMS_KEYS.filter((k) => body[k] !== undefined).sort(),
        },
        { businessId },
      );
      return this.one(tx, businessId, actor, row.id);
    });
  }

  /** Save: a draft's fields; notes on any version not superseded or terminated. */
  update(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Fields,
  ): Promise<BookkeepingTerms> {
    this.assertManager(actor);
    return this.run(businessId, async (tx) => {
      const { row } = await this.findTerms(tx, businessId, actor, termsId);
      const sent = TERMS_KEYS.filter((k) => body[k] !== undefined);
      if (sent.length && row.status !== 'DRAFT')
        throw termsState('Only draft terms are edited: create a new version');
      if (row.status === 'SUPERSEDED' || row.status === 'TERMINATED')
        throw termsState(
          `${row.status === 'SUPERSEDED' ? 'Superseded' : 'Terminated'} terms never change`,
        );
      // Dates compare as their days; lists and rules as JSON.
      const before = (k: string) => {
        const v = row[k as keyof TermsRow];
        return v instanceof Date ? day(v) : v;
      };
      const changed = sent.filter((k) => JSON.stringify(before(k)) !== JSON.stringify(body[k]));
      await tx.bookkeepingTerms.update({ where: { id: termsId }, data: this.data(body) });
      const kinds = new Map<BookkeepingTermsEventKind, Record<string, unknown>>();
      for (const k of changed) {
        const kind = EVENT_OF[k];
        if (!kind) continue;
        const entry = kinds.get(kind) ?? {};
        const from = shortValue(k, row[k as keyof TermsRow]);
        entry[k] =
          from === undefined && (JSON_KEYS as readonly string[]).includes(k)
            ? { changed: true }
            : { from, to: body[k] };
        kinds.set(kind, entry);
      }
      for (const [kind, details] of kinds)
        await this.event(tx, businessId, actor, termsId, kind, { details });
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.updated',
        { type: 'bookkeeping_terms', id: termsId },
        {
          fields: [
            ...changed,
            ...(body.internalNotes !== undefined ? ['internalNotes'] : []),
          ].sort(),
        },
        { businessId },
      );
      return this.one(tx, businessId, actor, termsId);
    });
  }

  /** A status move, with its History event and audit row. */
  private async move(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    from: readonly string[],
    to: 'SENT' | 'DRAFT' | 'ACTIVE' | 'TERMINATED',
    extra: (
      row: TermsRow,
      tx: TxClient,
    ) => Promise<{
      data?: Prisma.BookkeepingTermsUncheckedUpdateInput;
      kind: BookkeepingTermsEventKind;
      event?: Parameters<BookkeepingTermsService['event']>[5];
    }>,
  ): Promise<BookkeepingTerms> {
    this.assertManager(actor);
    return this.run(businessId, async (tx) => {
      const { row } = await this.findTerms(tx, businessId, actor, termsId);
      if (!from.includes(row.status)) throw termsState();
      const plan = await extra(row, tx);
      const before =
        to === 'ACTIVE'
          ? await tx.bookkeepingTerms.findFirst({
              where: {
                businessId,
                engagementId: row.engagementId,
                status: 'ACTIVE',
                id: { not: termsId },
              },
              select: { id: true, version: true },
            })
          : null;
      const { count } = await tx.bookkeepingTerms.updateMany({
        where: { businessId, id: termsId, status: row.status },
        data: { ...plan.data, status: to },
      });
      if (count !== 1) throw termsState('These terms were just changed. Reload and try again.');
      await this.event(tx, businessId, actor, termsId, plan.kind, plan.event);
      if (before)
        await this.event(tx, businessId, actor, before.id, 'SUPERSEDED', {
          details: { byTermsId: termsId, byVersion: row.version },
        });
      await this.audit.logIn(
        tx,
        `bookkeeping_terms.${plan.kind.toLowerCase()}`,
        { type: 'bookkeeping_terms', id: termsId },
        { from: row.status, to, supersededTermsId: before?.id ?? null },
        { businessId },
      );
      return this.one(tx, businessId, actor, termsId);
    });
  }

  send(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Out<typeof SendBookkeepingTermsRequest>,
  ) {
    return this.move(businessId, actor, termsId, ['DRAFT'], 'SENT', async () => ({
      kind: 'SENT',
      event: { reason: body.note ?? null },
    }));
  }

  backToDraft(businessId: string, actor: BookkeepingActor, termsId: string) {
    return this.move(businessId, actor, termsId, ['SENT'], 'DRAFT', async () => ({
      kind: 'NOTE',
      event: { reason: 'Back to draft', details: { from: 'SENT', to: 'DRAFT' } },
    }));
  }

  activate(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Out<typeof ActivateBookkeepingTermsRequest>,
  ) {
    return this.move(businessId, actor, termsId, ['DRAFT', 'SENT'], 'ACTIVE', async (row) => {
      if (body.requireSigned && !row.signedAt) throw notSigned();
      return {
        kind: 'ACTIVATED',
        event: {
          effectiveDate: day(row.effectiveFrom),
          reason: body.note ?? null,
          details: { version: row.version, signed: !!row.signedAt },
        },
      };
    });
  }

  terminate(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Out<typeof TerminateBookkeepingTermsRequest>,
  ) {
    return this.move(businessId, actor, termsId, ['ACTIVE'], 'TERMINATED', async () => ({
      data: { terminationReason: body.reason },
      kind: 'TERMINATED',
      event: {
        effectiveDate: body.effectiveDate,
        noticeSentAt: body.noticeSentAt ?? null,
        reason: body.reason,
      },
    }));
  }

  /** Renewal & Notices: an event on the version in force. */
  recordNotice(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Out<typeof BookkeepingTermsNoticeRequest>,
  ): Promise<BookkeepingTermsEvent> {
    this.assertManager(actor);
    return this.run(businessId, async (tx) => {
      const { row } = await this.findTerms(tx, businessId, actor, termsId);
      if (row.status !== 'ACTIVE') throw termsState('Notices go on the terms in force');
      const details: Record<string, unknown> =
        body.newMonthlyFeeCents !== undefined
          ? { monthlyFeeCents: { from: row.monthlyFeeCents, to: body.newMonthlyFeeCents } }
          : {};
      const made = await this.event(tx, businessId, actor, termsId, body.kind, {
        effectiveDate: body.effectiveDate ?? null,
        noticeSentAt: body.noticeSentAt ?? null,
        reason: body.reason ?? null,
        details,
      });
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.notice_recorded',
        { type: 'bookkeeping_terms', id: termsId },
        { kind: body.kind, eventId: made.id },
        { businessId },
      );
      return (await this.events(tx, businessId, { termsIds: [termsId], ids: [made.id] }))[0]!;
    });
  }

  /** Engagement Documents: this client's documents and Firm Sign request, linked or cleared. */
  setAgreement(
    businessId: string,
    actor: BookkeepingActor,
    termsId: string,
    body: Out<typeof SetBookkeepingTermsAgreementRequest>,
  ): Promise<BookkeepingTerms> {
    this.assertManager(actor);
    return this.run(businessId, async (tx) => {
      const { row } = await this.findTerms(tx, businessId, actor, termsId);
      if (row.status === 'SUPERSEDED' || row.status === 'TERMINATED') throw termsState();
      if (body.agreementDocumentId !== undefined && row.status !== 'DRAFT')
        throw termsState('The agreement to sign changes on a draft only');
      for (const docId of [body.agreementDocumentId, body.signedAgreementDocumentId]) {
        if (!docId) continue;
        const doc = await tx.document.findFirst({
          where: { businessId, engagementId: row.engagementId, id: docId },
          select: { id: true },
        });
        if (!doc) throw errors.notThisClients('document');
      }
      if (body.esignRequestId) {
        const engagement = await tx.engagement.findFirstOrThrow({
          where: { businessId, id: row.engagementId },
          select: { clientId: true },
        });
        // Firm Sign's request for this client (any of its services).
        const request = await tx.esignRequest.findFirst({
          where: { businessId, id: body.esignRequestId },
          select: { clientId: true },
        });
        if (!request || request.clientId !== engagement.clientId)
          throw errors.notThisClients('e-signature request');
      }
      const data: Prisma.BookkeepingTermsUncheckedUpdateInput = {};
      if (body.agreementDocumentId !== undefined)
        data.agreementDocumentId = body.agreementDocumentId;
      if (body.signedAgreementDocumentId !== undefined)
        data.signedAgreementDocumentId = body.signedAgreementDocumentId;
      if (body.esignRequestId !== undefined) data.esignRequestId = body.esignRequestId;
      const signedCopy =
        body.signedAgreementDocumentId !== undefined
          ? body.signedAgreementDocumentId
          : row.signedAgreementDocumentId;
      const esign = body.esignRequestId !== undefined ? body.esignRequestId : row.esignRequestId;
      if (body.signed === true) {
        if (!signedCopy && !esign) throw notSigned();
        data.signedAt = new Date();
      } else if (body.signed === false || (!signedCopy && !esign)) {
        data.signedAt = null;
      }
      await tx.bookkeepingTerms.update({ where: { id: termsId }, data });
      const details = Object.fromEntries(
        (['agreementDocumentId', 'signedAgreementDocumentId', 'esignRequestId', 'signed'] as const)
          .filter((k) => body[k] !== undefined)
          .map((k) => [k, body[k]]),
      );
      await this.event(tx, businessId, actor, termsId, body.signed ? 'SIGNED' : 'NOTE', {
        reason: body.signed ? null : 'Agreement documents changed',
        details,
      });
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.agreement_set',
        { type: 'bookkeeping_terms', id: termsId },
        details,
        { businessId },
      );
      return this.one(tx, businessId, actor, termsId);
    });
  }

  // ---------- History and the payment schedule ----------

  private async events(
    tx: TxClient,
    businessId: string,
    q: {
      termsIds: string[];
      ids?: string[];
      kind?: BookkeepingTermsEventKind;
      before?: { at: Date; id: string };
      take?: number;
    },
  ): Promise<BookkeepingTermsEvent[]> {
    const rows = await tx.bookkeepingTermsEvent.findMany({
      where: {
        AND: [
          { businessId, termsId: { in: q.termsIds } },
          q.ids ? { id: { in: q.ids } } : {},
          q.kind ? { kind: q.kind } : {},
          q.before
            ? {
                OR: [
                  { createdAt: { lt: q.before.at } },
                  { createdAt: q.before.at, id: { lt: q.before.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(q.take ? { take: q.take } : {}),
      include: { terms: { select: { version: true } } },
    });
    const names = await this.names(
      tx,
      businessId,
      rows.map((r) => r.actorUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      termsId: r.termsId,
      version: r.terms.version,
      kind: r.kind,
      effectiveDate: day(r.effectiveDate),
      noticeSentAt: iso(r.noticeSentAt),
      reason: r.reason,
      details: (r.details ?? {}) as Record<string, unknown>,
      actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
      at: r.createdAt.toISOString(),
    }));
  }

  history(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: Out<typeof BookkeepingTermsHistoryQuery>,
  ): Promise<BookkeepingTermsHistory> {
    return this.run(businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const versions = await tx.bookkeepingTerms.findMany({
        where: { businessId, engagementId: p.engagementId },
        select: { id: true },
      });
      const items = await this.events(tx, businessId, {
        termsIds: versions.map((v) => v.id),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.cursor ? { before: decode(q.cursor) } : {}),
        take: q.limit + 1,
      });
      const page = items.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor: items.length > q.limit && last ? encode(new Date(last.at), last.id) : null,
      };
    });
  }

  paymentSchedule(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: Out<typeof BookkeepingPaymentScheduleQuery>,
  ): Promise<BookkeepingPaymentSchedule> {
    return this.run(businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      // Drafts are the firm's work in progress, never on the client's schedule.
      if (q.status === 'DRAFT') return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      const where: Prisma.InvoiceWhereInput = {
        businessId,
        engagementId: p.engagementId,
        status: q.status ?? { not: 'DRAFT' },
      };
      const [total, rows] = await Promise.all([
        tx.invoice.count({ where }),
        tx.invoice.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: {
            id: true,
            number: true,
            status: true,
            totalCents: true,
            dueOn: true,
            issuedAt: true,
            scheduledFor: true,
            createdAt: true,
            paidAt: true,
          },
        }),
      ]);
      return {
        items: rows.map((r) => ({
          invoiceId: r.id,
          number: r.number,
          period: monthName(r.issuedAt ?? r.scheduledFor ?? r.createdAt),
          issuedOn: r.issuedAt ? r.issuedAt.toISOString().slice(0, 10) : day(r.scheduledFor),
          dueOn: day(r.dueOn),
          amountCents: r.totalCents,
          status: r.status,
          paidAt: iso(r.paidAt),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
}
