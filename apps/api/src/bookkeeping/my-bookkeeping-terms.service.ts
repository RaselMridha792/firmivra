import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AcceptMyBookkeepingTermsRequest,
  BookkeepingTerms,
  DeclineMyBookkeepingTermsRequest,
  EsignRequestStatus,
  MyBookkeepingTerms,
  MyBookkeepingTermsRow,
  MyBookkeepingTermsSignature,
  MyBookkeepingTermsState,
  OkResponse,
  TermsDiscount,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { addTermsEvent } from './bookkeeping-terms.service.js';
import { day, errors, inFirm } from './bookkeeping.shared.js';

type Accept = z.output<typeof AcceptMyBookkeepingTermsRequest>;
type Decline = z.output<typeof DeclineMyBookkeepingTermsRequest>;

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const notWaiting = () => conflict('TERMS_STATE', 'These terms are not waiting for your answer');
const changed = () =>
  conflict('TERMS_CHANGED', 'The firm changed these terms since you opened them. Reload them.');
const signFirst = () =>
  conflict('SIGNATURE_PENDING', 'Sign the agreement under Signatures first, then accept.');

/** The versions a client sees: every one that left the firm's drafts. */
const SHOWN = ['SENT', 'ACTIVE', 'SUPERSEDED', 'TERMINATED'] as const;
type Shown = (typeof SHOWN)[number];
const STATE: Record<Shown, MyBookkeepingTermsState> = {
  SENT: 'AWAITING_ANSWER',
  ACTIVE: 'IN_FORCE',
  SUPERSEDED: 'REPLACED',
  TERMINATED: 'ENDED',
};
/** A Firm Sign request as the client knows it; a draft or one awaiting the firm's approval: none. */
const SIGNATURE: Partial<Record<EsignRequestStatus, MyBookkeepingTermsSignature>> = {
  SENT: 'WAITING',
  DELIVERED: 'WAITING',
  VIEWED: 'WAITING',
  PARTIALLY_SIGNED: 'WAITING',
  COMPLETED: 'SIGNED',
  DECLINED: 'CLOSED',
  EXPIRED: 'CLOSED',
  VOIDED: 'CLOSED',
};
/** The client's own answer, as History and Activity record it. */
const BY_CLIENT = 'CLIENT';
const ACCEPTED = 'accepted by the client in the portal';
const DECLINED = 'declined by the client in the portal';

/**
 * The portal version's columns: never the internal notes, the termination reason, the package's
 * catalog id or who created it.
 */
const select = {
  id: true,
  engagementId: true,
  version: true,
  status: true,
  packageName: true,
  startDate: true,
  endDate: true,
  renewalType: true,
  renewalDate: true,
  noticeDays: true,
  effectiveFrom: true,
  billingFrequency: true,
  billingTiming: true,
  paymentTerms: true,
  paymentTermsDays: true,
  preferredPaymentMethod: true,
  autopay: true,
  monthlyFeeCents: true,
  setupFeeCents: true,
  additionalBilling: true,
  lateFeeRule: true,
  discounts: true,
  includedServices: true,
  excludedServices: true,
  addOns: true,
  deliverables: true,
  clientResponsibilities: true,
  firmResponsibilities: true,
  sentAt: true,
  signedAt: true,
  activatedAt: true,
  supersededAt: true,
  terminatedAt: true,
  engagement: { select: { title: true } },
  esignRequest: { select: { status: true } },
} satisfies Prisma.BookkeepingTermsSelect;
type Row = Prisma.BookkeepingTermsGetPayload<{ select: typeof select }>;

interface Login {
  clientId: string;
  /** Primary or Spouse: reads the household's terms. */
  household: boolean;
  /** Only the Primary login answers. */
  primary: boolean;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
const signatureOf = (row: Row) =>
  row.esignRequest ? (SIGNATURE[row.esignRequest.status] ?? null) : null;

/**
 * Client Portal BK-CP3 (R55): the bookkeeping terms the firm sent, in the client's portal
 * (contract in packages/types/src/bookkeeping/terms-portal.ts). The client comes from the
 * session, never the URL; a draft, another client's or another firm's version is 404. The
 * statuses already hold the answer: Accept is SENT to ACTIVE (the database replaces the version in
 * force, as the firm's Activate does), Decline is SENT back to DRAFT for the firm to revise. Each
 * answer writes the History event and the Activity line (no staff author), an audit row with ids
 * only and a bell item for the firm. Reads are audited too.
 */
@Injectable()
export class MyBookkeepingTermsService {
  private readonly logger = new Logger(MyBookkeepingTermsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private async login(
    tx: TxClient,
    businessId: string,
    clientAccountId: string,
  ): Promise<Login | null> {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true, portalRole: true },
    });
    if (!account?.clientId) return null;
    return {
      clientId: account.clientId,
      household: account.portalRole !== 'AUTHORIZED',
      primary: account.portalRole === 'PRIMARY',
    };
  }

  /** One version this login may read; anything else is 404. */
  private async find(tx: TxClient, businessId: string, me: Login | null, id: string) {
    if (!me?.household) throw errors.notFound();
    const row = await tx.bookkeepingTerms.findFirst({
      where: {
        businessId,
        id,
        status: { in: [...SHOWN] },
        engagement: { clientId: me.clientId },
      },
      select,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  private toRow(row: Row): MyBookkeepingTermsRow {
    return {
      id: row.id,
      serviceId: row.engagementId,
      serviceTitle: row.engagement.title,
      version: row.version,
      state: STATE[row.status as Shown],
      packageName: row.packageName,
      monthlyFeeCents: row.monthlyFeeCents,
      effectiveFrom: day(row.effectiveFrom) as string,
      sentAt: iso(row.sentAt),
      activatedAt: iso(row.activatedAt),
    };
  }

  private async view(
    tx: TxClient,
    businessId: string,
    me: Login,
    row: Row,
  ): Promise<MyBookkeepingTerms> {
    const accepted = await tx.bookkeepingTermsEvent.findFirst({
      where: {
        businessId,
        termsId: row.id,
        kind: 'ACTIVATED',
        details: { path: ['by'], equals: BY_CLIENT },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const signature = signatureOf(row);
    const waiting = row.status === 'SENT' && me.primary;
    return {
      ...this.toRow(row),
      startDate: day(row.startDate) as string,
      endDate: day(row.endDate),
      renewalType: row.renewalType,
      renewalDate: day(row.renewalDate),
      noticeDays: row.noticeDays,
      billingFrequency: row.billingFrequency,
      billingTiming: row.billingTiming,
      paymentTerms: row.paymentTerms,
      paymentTermsDays: row.paymentTermsDays,
      preferredPaymentMethod: row.preferredPaymentMethod,
      autopay: row.autopay,
      setupFeeCents: row.setupFeeCents,
      additionalBilling: row.additionalBilling as MyBookkeepingTerms['additionalBilling'],
      lateFeeRule: row.lateFeeRule as MyBookkeepingTerms['lateFeeRule'],
      // The label and the amount; never the firm's reason for it.
      discounts: (row.discounts as TermsDiscount[]).map((d) => ({
        label: d.label,
        kind: d.kind,
        value: d.value,
        startsOn: d.startsOn ?? null,
        endsOn: d.endsOn ?? null,
      })),
      includedServices: row.includedServices as string[],
      excludedServices: row.excludedServices as string[],
      addOns: row.addOns as BookkeepingTerms['addOns'],
      deliverables: row.deliverables as BookkeepingTerms['deliverables'],
      clientResponsibilities: row.clientResponsibilities as string[],
      firmResponsibilities: row.firmResponsibilities as string[],
      supersededAt: iso(row.supersededAt),
      terminatedAt: iso(row.terminatedAt),
      acceptedAt: iso(accepted?.createdAt ?? null),
      signature,
      can: { accept: waiting && signature !== 'WAITING', decline: waiting },
    };
  }

  async list(businessId: string, clientAccountId: string): Promise<MyBookkeepingTermsRow[]> {
    const { items, clientId } = await inFirm(this.database, businessId, async (tx) => {
      const me = await this.login(tx, businessId, clientAccountId);
      if (!me?.household) return { items: [], clientId: me?.clientId ?? null };
      const rows = await tx.bookkeepingTerms.findMany({
        where: { businessId, status: { in: [...SHOWN] }, engagement: { clientId: me.clientId } },
        orderBy: [{ engagementId: 'desc' }, { version: 'desc' }],
        select,
      });
      return { items: rows.map((r) => this.toRow(r)), clientId: me.clientId };
    });
    if (clientId) {
      await this.audit.log(
        'portal.bookkeeping_terms_listed',
        { type: 'client', id: clientId },
        { count: items.length, clientAccountId },
      );
    }
    return items;
  }

  async get(businessId: string, clientAccountId: string, id: string): Promise<MyBookkeepingTerms> {
    const { terms, clientId } = await inFirm(this.database, businessId, async (tx) => {
      const me = await this.login(tx, businessId, clientAccountId);
      const row = await this.find(tx, businessId, me, id);
      return { terms: await this.view(tx, businessId, me!, row), clientId: me!.clientId };
    });
    await this.audit.log(
      'portal.bookkeeping_terms_viewed',
      { type: 'bookkeeping_terms', id: terms.id },
      { clientId, version: terms.version, clientAccountId },
    );
    return terms;
  }

  /**
   * The version waiting for this login's answer, exactly as sent (`sentAt`): 404 for anyone who may
   * not read it, 403 for a Spouse login, 409 TERMS_STATE once it is not waiting, 409 TERMS_CHANGED
   * for another sending.
   */
  private async waiting(
    tx: TxClient,
    businessId: string,
    clientAccountId: string,
    id: string,
    sentAt: string,
  ) {
    const me = await this.login(tx, businessId, clientAccountId);
    // One answer per version at a time; the firm's changes check the status they read.
    await tx.$executeRaw`SELECT 1 FROM bookkeeping_terms WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR NO KEY UPDATE`;
    const row = await this.find(tx, businessId, me, id);
    if (!me!.primary) throw errors.forbidden();
    if (row.status !== 'SENT') throw notWaiting();
    if (row.sentAt?.getTime() !== new Date(sentAt).getTime()) throw changed();
    const profile = await tx.bookkeepingProfile.findFirst({
      where: { businessId, engagementId: row.engagementId },
      select: { id: true },
    });
    if (!profile) throw errors.notFound();
    return { me: me!, row, profileId: profile.id };
  }

  /** Accept: the version comes into force and replaces the one before. */
  async accept(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: Accept,
  ): Promise<MyBookkeepingTerms> {
    const { terms, profileId } = await inFirm(this.database, businessId, async (tx) => {
      const { me, row, profileId } = await this.waiting(
        tx,
        businessId,
        clientAccountId,
        id,
        body.sentAt,
      );
      if (signatureOf(row) === 'WAITING') throw signFirst();
      const before = await tx.bookkeepingTerms.findFirst({
        where: { businessId, engagementId: row.engagementId, status: 'ACTIVE', id: { not: id } },
        select: { id: true },
      });
      const { count } = await tx.bookkeepingTerms.updateMany({
        where: { businessId, id, status: 'SENT', sentAt: row.sentAt },
        data: { status: 'ACTIVE' },
      });
      if (count !== 1) throw changed();
      await addTermsEvent(
        tx,
        businessId,
        null,
        id,
        'ACTIVATED',
        {
          effectiveDate: day(row.effectiveFrom),
          details: { version: row.version, signed: !!row.signedAt, by: BY_CLIENT },
        },
        ACCEPTED,
      );
      if (before) {
        await addTermsEvent(tx, businessId, null, before.id, 'SUPERSEDED', {
          details: { byTermsId: id, byVersion: row.version },
        });
      }
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.client_accepted',
        { type: 'bookkeeping_terms', id },
        {
          from: 'SENT',
          to: 'ACTIVE',
          supersededTermsId: before?.id ?? null,
          clientId: me.clientId,
          clientAccountId,
          by: BY_CLIENT,
        },
        { businessId },
      );
      const now = await tx.bookkeepingTerms.findFirstOrThrow({ where: { businessId, id }, select });
      return { terms: await this.view(tx, businessId, me, now), profileId };
    });
    await this.tellFirm('bookkeeping-terms.client-accepted', businessId, profileId, id, body);
    return terms;
  }

  /** Decline: the version goes back to the firm as a draft, with the client's reason if given. */
  async decline(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: Decline,
  ): Promise<OkResponse> {
    const profileId = await inFirm(this.database, businessId, async (tx) => {
      const { me, row, profileId } = await this.waiting(
        tx,
        businessId,
        clientAccountId,
        id,
        body.sentAt,
      );
      const { count } = await tx.bookkeepingTerms.updateMany({
        where: { businessId, id, status: 'SENT', sentAt: row.sentAt },
        data: { status: 'DRAFT' },
      });
      if (count !== 1) throw changed();
      await addTermsEvent(
        tx,
        businessId,
        null,
        id,
        'NOTE',
        {
          reason: body.reason
            ? `Declined by the client in the portal: ${body.reason}`
            : 'Declined by the client in the portal',
          details: { from: 'SENT', to: 'DRAFT', by: BY_CLIENT },
        },
        DECLINED,
      );
      await this.audit.logIn(
        tx,
        'bookkeeping_terms.client_declined',
        { type: 'bookkeeping_terms', id },
        {
          from: 'SENT',
          to: 'DRAFT',
          clientId: me.clientId,
          clientAccountId,
          by: BY_CLIENT,
          withReason: !!body.reason,
        },
        { businessId },
      );
      return profileId;
    });
    await this.tellFirm('bookkeeping-terms.client-declined', businessId, profileId, id, body);
    return { ok: true };
  }

  /**
   * The firm hears of the answer: a bell item for the client's assigned member and the Owners and
   * Admins, opening the Terms page; once per answer to a sending. A failure is logged with ids
   * only and never undoes the answer.
   */
  private async tellFirm(
    event: 'bookkeeping-terms.client-accepted' | 'bookkeeping-terms.client-declined',
    businessId: string,
    profileId: string,
    termsId: string,
    body: { sentAt: string },
  ): Promise<void> {
    try {
      await this.notifier.notify({
        businessId,
        event,
        recordId: profileId,
        eventKey: `${event}:${termsId}:${new Date(body.sentAt).toISOString()}`,
      });
    } catch (error) {
      this.logger.warn(`${event} for terms ${termsId} not sent (${errorName(error)})`);
    }
  }
}
