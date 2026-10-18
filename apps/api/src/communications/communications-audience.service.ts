import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  AudienceCandidatePage,
  AudienceChip,
  AudienceSummary,
  CommunicationChannel,
  SelectAllAudienceResult,
} from '@firmivra/types';
import type { z } from 'zod';
import { mask } from './communications.common.js';
import type { AudienceCandidatesQ, SelectAllAudienceBody } from './communications-input.js';
import { type SegCtx, CommunicationSegmentsService } from './communications-segments.service.js';

type Out<S extends z.ZodType> = z.output<S>;

export interface Person {
  kind: 'CLIENT' | 'LEAD';
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}
export type Reason = 'UNSUBSCRIBED' | 'INVALID' | 'MISSING_CHANNEL' | 'NO_CONSENT' | 'DUPLICATE';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/** A phone number as +E.164 when it can be one (a 10-digit US number gets +1), else null. */
export function e164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const candidate = raw.trim().startsWith('+')
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith('1')
        ? `+${digits}`
        : '';
  return E164.test(candidate) ? candidate : null;
}

export const keyOf = (p: { kind: string; id: string }) => `${p.kind[0]}:${p.id}`;

/** The address a person is reached at on a channel, or null. */
export const addressOf = (p: Person, channel: CommunicationChannel): string | null =>
  channel === 'EMAIL' ? p.email : channel === 'SMS' ? p.phone : null;

/** Who a campaign goes to, and who must be left out and why (recalculated whenever it is asked for). */
@Injectable()
export class CommunicationAudienceService {
  constructor(private readonly segments: CommunicationSegmentsService) {}

  /** Why each person cannot get the channel (absent = eligible). Consent and address checks. */
  async reasons(
    ctx: SegCtx,
    channel: CommunicationChannel,
    people: Person[],
  ): Promise<Map<string, Exclude<Reason, 'DUPLICATE'>>> {
    const out = new Map<string, Exclude<Reason, 'DUPLICATE'>>();
    if (channel === 'ANNOUNCEMENT') {
      for (const p of people) if (p.kind === 'LEAD') out.set(keyOf(p), 'MISSING_CHANNEL');
      return out;
    }
    const clientIds = people.filter((p) => p.kind === 'CLIENT').map((p) => p.id);
    const leadIds = people.filter((p) => p.kind === 'LEAD').map((p) => p.id);
    const rows = await ctx.tx.communicationConsent.findMany({
      where: {
        businessId: ctx.businessId,
        channel,
        OR: [{ clientId: { in: clientIds } }, { leadId: { in: leadIds } }],
      },
      select: { clientId: true, leadId: true, status: true },
    });
    const consent = new Map(
      rows.map((r) => [r.clientId ? `C:${r.clientId}` : `L:${r.leadId}`, r.status]),
    );
    for (const p of people) {
      const address = addressOf(p, channel);
      const standing = consent.get(keyOf(p));
      if (!address) out.set(keyOf(p), 'MISSING_CHANNEL');
      else if (channel === 'EMAIL' ? !EMAIL.test(address) : e164(address) === null)
        out.set(keyOf(p), 'INVALID');
      else if (standing === 'OPTED_OUT' || standing === 'COMPLAINED')
        out.set(keyOf(p), 'UNSUBSCRIBED');
      else if (standing === 'BOUNCED' || standing === 'INVALID') out.set(keyOf(p), 'INVALID');
      // A text needs an opt-in on record; an email only needs that nobody opted out.
      else if (channel === 'SMS' && standing !== 'OPTED_IN') out.set(keyOf(p), 'NO_CONSENT');
    }
    return out;
  }

  private async loadPeople(ctx: SegCtx, clientIds: string[], leadIds: string[]): Promise<Person[]> {
    const [cs, ls] = await Promise.all([
      clientIds.length
        ? ctx.tx.client.findMany({
            where: { AND: [this.segments.clientReach(ctx), { id: { in: clientIds } }] },
            select: { id: true, displayName: true, email: true, phone: true },
          })
        : [],
      leadIds.length
        ? ctx.tx.lead.findMany({
            where: { AND: [this.segments.leadReach(ctx), { id: { in: leadIds } }] },
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          })
        : [],
    ]);
    return [
      ...cs.map((c) => ({
        kind: 'CLIENT' as const,
        id: c.id,
        name: c.displayName,
        email: c.email,
        phone: c.phone,
      })),
      ...ls.map((l) => ({
        kind: 'LEAD' as const,
        id: l.id,
        name: `${l.firstName} ${l.lastName}`,
        email: l.email,
        phone: l.phone,
      })),
    ];
  }

  /** The audience of a campaign as it stands now: the summary, the people to send to, and those left out. */
  async compute(
    ctx: SegCtx,
    comm: { id: string; channel: CommunicationChannel },
  ): Promise<{
    summary: AudienceSummary;
    eligible: Person[];
    excluded: { person: Person; reason: Reason }[];
  }> {
    const entries = await ctx.tx.communicationAudienceEntry.findMany({
      where: { businessId: ctx.businessId, communicationId: comm.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const clientIds = new Set<string>();
    const leadIds = new Set<string>();
    const outC = new Set<string>();
    const outL = new Set<string>();
    const chips: AudienceChip[] = [];
    const labels = await this.labelsFor(ctx, entries);
    for (const e of entries) {
      if (e.kind === 'SEGMENT' && e.segmentId) {
        const seg = await this.segments.peopleOf(ctx, e.segmentId);
        const count = seg ? seg.clientIds.length + seg.leadIds.length : 0;
        seg?.clientIds.forEach((id) => clientIds.add(id));
        seg?.leadIds.forEach((id) => leadIds.add(id));
        chips.push({
          kind: 'SEGMENT',
          id: e.segmentId,
          label: seg?.name ?? e.segmentName ?? 'Segment',
          count,
        });
      } else if (e.kind === 'CLIENT' && e.clientId) clientIds.add(e.clientId);
      else if (e.kind === 'LEAD' && e.leadId) leadIds.add(e.leadId);
      else if (e.kind === 'EXCLUDE_CLIENT' && e.clientId) outC.add(e.clientId);
      else if (e.kind === 'EXCLUDE_LEAD' && e.leadId) outL.add(e.leadId);
      if (e.kind !== 'SEGMENT') {
        const id = (e.clientId ?? e.leadId) as string;
        chips.push({
          kind: e.kind as AudienceChip['kind'],
          id,
          label: labels.get(id) ?? 'Contact',
          count: null,
        });
      }
    }
    const people = await this.loadPeople(ctx, [...clientIds], [...leadIds]);
    const manual = people.filter((p) => (p.kind === 'CLIENT' ? outC : outL).has(p.id));
    const rest = people.filter((p) => !(p.kind === 'CLIENT' ? outC : outL).has(p.id));
    const why = await this.reasons(ctx, comm.channel, rest);
    const excluded: { person: Person; reason: Reason }[] = [];
    const eligible: Person[] = [];
    const seen = new Set<string>();
    const ordered = [...rest].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    for (const p of ordered) {
      const reason = why.get(keyOf(p));
      if (reason) {
        excluded.push({ person: p, reason });
        continue;
      }
      const address = addressOf(p, comm.channel);
      const dedupe =
        comm.channel === 'EMAIL'
          ? (address as string).toLowerCase()
          : comm.channel === 'SMS'
            ? (e164(address) as string)
            : keyOf(p);
      if (seen.has(dedupe)) excluded.push({ person: p, reason: 'DUPLICATE' });
      else {
        seen.add(dedupe);
        eligible.push(p);
      }
    }
    const n = (r: Reason | Reason[]) =>
      excluded.filter((x) => (Array.isArray(r) ? r : [r]).includes(x.reason)).length;
    return {
      summary: {
        selectedCount: people.length,
        autoExcluded: {
          unsubscribed: n('UNSUBSCRIBED'),
          invalid: n('INVALID'),
          missingChannel: n('MISSING_CHANNEL'),
          duplicate: n('DUPLICATE'),
          ineligible: n('NO_CONSENT'),
        },
        manualExcludedCount: manual.length,
        finalCount: eligible.length,
        chips,
        calculatedAt: new Date().toISOString(),
      },
      eligible,
      excluded,
    };
  }

  private async labelsFor(
    ctx: SegCtx,
    entries: { clientId: string | null; leadId: string | null }[],
  ): Promise<Map<string, string>> {
    const c = entries.flatMap((e) => (e.clientId ? [e.clientId] : []));
    const l = entries.flatMap((e) => (e.leadId ? [e.leadId] : []));
    const people = await this.loadPeople(ctx, c, l);
    return new Map(people.map((p) => [p.id, p.name]));
  }

  // ---------- Choose Recipients ----------

  /** The filter of the active view: which table it reads and what narrows it. */
  private scope(ctx: SegCtx, q: Out<typeof SelectAllAudienceBody>) {
    const search = q.search;
    const clientBase: Prisma.ClientWhereInput[] = [
      this.segments.clientReach(ctx),
      ...(search ? [{ displayName: { contains: search, mode: 'insensitive' as const } }] : []),
    ];
    switch (q.view) {
      case 'LEADS':
        return {
          kind: 'LEAD' as const,
          where: {
            AND: [
              this.segments.leadReach(ctx),
              ...(search
                ? [
                    {
                      OR: [
                        { firstName: { contains: search, mode: 'insensitive' as const } },
                        { lastName: { contains: search, mode: 'insensitive' as const } },
                      ],
                    },
                  ]
                : []),
            ],
          } satisfies Prisma.LeadWhereInput,
        };
      case 'SEGMENTS':
      case 'LISTS':
        return {
          kind: 'SEGMENT' as const,
          where: {
            businessId: ctx.businessId,
            archivedAt: null,
            type: q.view === 'LISTS' ? ('STATIC' as const) : ('DYNAMIC' as const),
            ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
          } satisfies Prisma.CommunicationSegmentWhereInput,
        };
      case 'SERVICES':
        return {
          kind: 'CLIENT' as const,
          where: {
            AND: [
              ...clientBase,
              q.serviceId
                ? { engagements: { some: { serviceId: q.serviceId } } }
                : { id: { in: [] } },
            ],
          } satisfies Prisma.ClientWhereInput,
        };
      case 'STATUSES': {
        const ok = ['NEW', 'PENDING_DOCUMENTS', 'IN_PROGRESS', 'ACTIVE', 'ON_HOLD', 'INACTIVE'];
        return {
          kind: 'CLIENT' as const,
          where: {
            AND: [
              ...clientBase,
              q.status && ok.includes(q.status)
                ? { status: q.status as 'ACTIVE' }
                : { id: { in: [] } },
            ],
          } satisfies Prisma.ClientWhereInput,
        };
      }
      default:
        return {
          kind: 'CLIENT' as const,
          where: { AND: clientBase } satisfies Prisma.ClientWhereInput,
        };
    }
  }

  /** A service named to narrow the view is the firm's own, or 404. */
  private async assertService(ctx: SegCtx, serviceId: string | undefined) {
    if (!serviceId) return;
    const found = await ctx.tx.service.findFirst({
      where: { businessId: ctx.businessId, id: serviceId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Service not found' });
  }

  async candidates(
    ctx: SegCtx,
    channel: CommunicationChannel,
    q: Out<typeof AudienceCandidatesQ>,
  ): Promise<AudienceCandidatePage> {
    await this.assertService(ctx, q.serviceId);
    const sc = this.scope(ctx, q);
    const skip = (q.page - 1) * q.pageSize;
    const mk = (p: Person, reasons: Map<string, Exclude<Reason, 'DUPLICATE'>>) => {
      const reason = reasons.get(keyOf(p)) ?? null;
      return {
        kind: p.kind,
        id: p.id,
        label: p.name,
        secondary: mask(addressOf(p, channel)) || null,
        count: null,
        eligible: reason === null,
        ineligibleReason: reason,
      };
    };
    if (sc.kind === 'SEGMENT') {
      const [total, rows] = await Promise.all([
        ctx.tx.communicationSegment.count({ where: sc.where }),
        ctx.tx.communicationSegment.findMany({
          where: sc.where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take: q.pageSize,
        }),
      ]);
      const items = [];
      for (const r of rows) {
        const people = await this.segments.peopleOf(ctx, r.id);
        items.push({
          kind: 'SEGMENT' as const,
          id: r.id,
          label: r.name,
          secondary: r.criteriaSummary ?? r.description,
          count: people ? people.clientIds.length + people.leadIds.length : 0,
          eligible: true,
          ineligibleReason: null,
        });
      }
      return { items, total, page: q.page, pageSize: q.pageSize };
    }
    if (sc.kind === 'LEAD') {
      const [total, rows] = await Promise.all([
        ctx.tx.lead.count({ where: sc.where }),
        ctx.tx.lead.findMany({
          where: sc.where,
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          skip,
          take: q.pageSize,
        }),
      ]);
      const people: Person[] = rows.map((l) => ({
        kind: 'LEAD',
        id: l.id,
        name: `${l.firstName} ${l.lastName}`,
        email: l.email,
        phone: l.phone,
      }));
      const reasons = await this.reasons(ctx, channel, people);
      return {
        items: people.map((p) => mk(p, reasons)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    }
    const [total, rows] = await Promise.all([
      ctx.tx.client.count({ where: sc.where }),
      ctx.tx.client.findMany({
        where: sc.where,
        select: { id: true, displayName: true, email: true, phone: true },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip,
        take: q.pageSize,
      }),
    ]);
    const people: Person[] = rows.map((c) => ({
      kind: 'CLIENT',
      id: c.id,
      name: c.displayName,
      email: c.email,
      phone: c.phone,
    }));
    const reasons = await this.reasons(ctx, channel, people);
    return {
      items: people.map((p) => mk(p, reasons)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Every eligible record in the filtered scope, at most 1,000. */
  async selectAll(
    ctx: SegCtx,
    channel: CommunicationChannel,
    q: Out<typeof SelectAllAudienceBody>,
  ): Promise<SelectAllAudienceResult> {
    await this.assertService(ctx, q.serviceId);
    const sc = this.scope(ctx, q);
    const LIMIT = 1_000;
    if (sc.kind === 'SEGMENT') {
      const rows = await ctx.tx.communicationSegment.findMany({
        where: sc.where,
        select: { id: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      return {
        clientIds: [],
        leadIds: [],
        segmentIds: rows.slice(0, LIMIT).map((r) => r.id),
        truncated: rows.length > LIMIT,
      };
    }
    const people: Person[] =
      sc.kind === 'LEAD'
        ? (
            await ctx.tx.lead.findMany({
              where: sc.where,
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
              orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
              take: 5_000,
            })
          ).map((l) => ({
            kind: 'LEAD' as const,
            id: l.id,
            name: `${l.firstName} ${l.lastName}`,
            email: l.email,
            phone: l.phone,
          }))
        : (
            await ctx.tx.client.findMany({
              where: sc.where,
              select: { id: true, displayName: true, email: true, phone: true },
              orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
              take: 5_000,
            })
          ).map((c) => ({
            kind: 'CLIENT' as const,
            id: c.id,
            name: c.displayName,
            email: c.email,
            phone: c.phone,
          }));
    const reasons = await this.reasons(ctx, channel, people);
    const ok = people.filter((p) => !reasons.has(keyOf(p)));
    const chosen = ok.slice(0, LIMIT);
    return {
      clientIds: chosen.filter((p) => p.kind === 'CLIENT').map((p) => p.id),
      leadIds: chosen.filter((p) => p.kind === 'LEAD').map((p) => p.id),
      segmentIds: [],
      truncated: ok.length > LIMIT || people.length >= 5_000,
    };
  }
}
