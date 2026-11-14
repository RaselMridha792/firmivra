import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  DismissLeadDuplicateRequest,
  LeadDuplicatePair,
  LeadDuplicateReason,
  LeadProfile,
  MergeLeadsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from './leads.service.js';
import {
  loadProfile,
  type PipelineActor,
  reach,
  rowSelect,
  toRow,
  visibleLead,
} from './pipeline.shared.js';

/** Leads the review compares at most (the newest open ones the member reaches). */
const SCAN_LIMIT = 2000;
const PAIR_LIMIT = 100;
/** Other contacts a lead keeps at most (the contract's own limit). */
const MAX_OTHER_CONTACTS = 10;

const notAllowed = (message: string) =>
  new ConflictException({ code: 'MERGE_NOT_ALLOWED', message });
const managersOnly = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'Only an Owner or Admin can merge leads or mark them as not duplicates',
  });

/** "jo@x.test" from " Jo@X.test "; null for none. */
const emailKey = (v: string | null | undefined) => (v ? v.trim().toLowerCase() : null);
/** The last 10 digits of a phone number (7 at least), so "+1 (404) 555-0101" matches "4045550101". */
function phoneKey(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}
const nameKey = (first: string, last: string) =>
  `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ').trim();

/** Open leads to compare: not a draft, converted, archived or merged one. */
const comparable = (businessId: string, actor: PipelineActor): Prisma.LeadWhereInput => ({
  AND: [
    visibleLead(businessId),
    reach(actor),
    { archivedAt: null, mergedIntoLeadId: null, status: { not: 'CONVERTED' } },
  ],
});

/**
 * Leads R2 15: duplicate review and safe merge, never automatic. Possible pairs come from the same
 * email or phone (a lead's own or any of its other contacts, phones by their last 10 digits) or
 * the same full name; a pair marked "Not a duplicate" leaves the review. A merge (Owner, Admin)
 * keeps one lead with the values the reviewer chose from either, adds the other's tags, services
 * and every phone and email it had, and archives the other with merged_into (the database makes
 * it final). Nothing is moved or lost: the merged lead keeps its notes, activity, tasks, files and
 * forms, opened from the kept lead. Audited with ids and field names only.
 */
@Injectable()
export class LeadMergeService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private requireManager(actor: PipelineActor) {
    if (legacyFirmRole(actor.role) === 'STAFF') throw managersOnly();
  }

  async duplicates(businessId: string, actor: PipelineActor): Promise<LeadDuplicatePair[]> {
    const pairs = await this.inFirm(businessId, async (tx) => {
      const leads = await tx.lead.findMany({
        where: comparable(businessId, actor),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SCAN_LIMIT,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          contactPoints: { select: { kind: true, value: true } },
        },
      });
      const order = new Map(leads.map((l, i) => [l.id, i]));
      // Each key (an email, a phone, a name) and the leads that have it.
      const byKey = new Map<string, { reason: LeadDuplicateReason; ids: Set<string> }>();
      const add = (reason: LeadDuplicateReason, key: string | null, id: string) => {
        if (!key) return;
        const k = `${reason}:${key}`;
        const entry = byKey.get(k) ?? { reason, ids: new Set<string>() };
        entry.ids.add(id);
        byKey.set(k, entry);
      };
      for (const l of leads) {
        add('EMAIL', emailKey(l.email), l.id);
        add('PHONE', phoneKey(l.phone), l.id);
        add('NAME', nameKey(l.firstName, l.lastName), l.id);
        for (const c of l.contactPoints) {
          add(c.kind, c.kind === 'EMAIL' ? emailKey(c.value) : phoneKey(c.value), l.id);
        }
      }
      const found = new Map<string, { ids: [string, string]; reasons: Set<LeadDuplicateReason> }>();
      for (const { reason, ids } of byKey.values()) {
        // A key shared by many leads (a placeholder email) says nothing about any two of them.
        if (ids.size < 2 || ids.size > 10) continue;
        const list = [...ids].sort((a, b) => order.get(a)! - order.get(b)!);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const pair: [string, string] = [list[i]!, list[j]!];
            const key = [...pair].sort().join(':');
            const entry = found.get(key) ?? { ids: pair, reasons: new Set() };
            entry.reasons.add(reason);
            found.set(key, entry);
          }
        }
      }
      if (found.size === 0) return [];
      const dismissed = await tx.leadDuplicateDismissal.findMany({
        where: { businessId },
        select: { leadId: true, otherLeadId: true },
      });
      const gone = new Set(dismissed.map((d) => [d.leadId, d.otherLeadId].sort().join(':')));
      const kept = [...found.entries()]
        .filter(([key]) => !gone.has(key))
        .map(([, v]) => v)
        .sort((a, b) => order.get(a.ids[0])! - order.get(b.ids[0])!)
        .slice(0, PAIR_LIMIT);
      const rows = await tx.lead.findMany({
        where: { businessId, id: { in: [...new Set(kept.flatMap((p) => p.ids))] } },
        select: rowSelect,
      });
      const byId = new Map(rows.map((r) => [r.id, toRow(r)]));
      return kept.map((p) => ({
        leads: [byId.get(p.ids[0])!, byId.get(p.ids[1])!] as LeadDuplicatePair['leads'],
        reasons: (['EMAIL', 'PHONE', 'NAME'] as const).filter((r) => p.reasons.has(r)),
      }));
    });
    await this.audit.log('leads.duplicates_viewed', { type: 'lead' }, { count: pairs.length });
    return pairs;
  }

  /** "Not a duplicate": the pair leaves the review (once; again is the same answer). */
  async dismiss(
    businessId: string,
    actor: PipelineActor,
    body: z.output<typeof DismissLeadDuplicateRequest>,
  ): Promise<{ ok: true }> {
    this.requireManager(actor);
    await this.inFirm(businessId, async (tx) => {
      const found = await tx.lead.count({
        where: { AND: [visibleLead(businessId), { id: { in: [body.leadId, body.otherLeadId] } }] },
      });
      if (found !== 2) throw notFound();
      const [a, b] = [body.leadId, body.otherLeadId].sort() as [string, string];
      const exists = await tx.leadDuplicateDismissal.findFirst({
        where: {
          businessId,
          OR: [
            { leadId: a, otherLeadId: b },
            { leadId: b, otherLeadId: a },
          ],
        },
        select: { id: true },
      });
      if (exists) return;
      const row = await tx.leadDuplicateDismissal.create({
        data: { businessId, leadId: a, otherLeadId: b, dismissedByUserId: actor.userId },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'lead.duplicate_dismissed',
        { type: 'lead', id: a },
        { otherLeadId: b, dismissalId: row.id },
      );
    });
    return { ok: true };
  }

  /** Merges `body.mergeLeadId` into lead `id` (see the class). */
  async merge(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: z.output<typeof MergeLeadsRequest>,
  ): Promise<LeadProfile> {
    this.requireManager(actor);
    if (body.mergeLeadId === id) throw notAllowed('Choose another lead to merge');
    return this.inFirm(businessId, async (tx) => {
      // Both rows held, in id order (two merges of the same pair can't cross).
      const both = [id, body.mergeLeadId].sort();
      for (const leadId of both) {
        await tx.$queryRaw`SELECT 1 FROM leads WHERE business_id = ${businessId}::uuid
          AND id = ${leadId}::uuid FOR UPDATE`;
      }
      const select = {
        id: true,
        status: true,
        archivedAt: true,
        mergedIntoLeadId: true,
        updatedAt: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        dateOfBirth: true,
        source: true,
        sourceDetail: true,
        priority: true,
        assignedUserId: true,
        number: true,
        contactPoints: {
          orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
          select: { kind: true, value: true, label: true },
        },
      } satisfies Prisma.LeadSelect;
      const [kept, merged] = await Promise.all(
        [id, body.mergeLeadId].map((leadId) =>
          tx.lead.findFirst({
            where: { AND: [visibleLead(businessId), { id: leadId }] },
            select,
          }),
        ),
      );
      if (!kept || !merged) throw notFound();
      for (const l of [kept, merged]) {
        if (l.status === 'CONVERTED') throw notAllowed('A converted lead cannot be merged');
        if (l.archivedAt || l.mergedIntoLeadId) {
          throw notAllowed('An archived or merged lead cannot be merged');
        }
      }
      if (
        body.versions &&
        (body.versions.kept !== kept.updatedAt.toISOString() ||
          body.versions.merged !== merged.updatedAt.toISOString())
      ) {
        throw new ConflictException({
          code: 'SAVE_CONFLICT',
          message: 'One of these leads changed after you opened them. Review them again.',
        });
      }
      const from = (field: string) => (body.take as Record<string, string>)[field] === 'MERGED';
      const data: Prisma.LeadUncheckedUpdateInput = { updatedByUserId: actor.userId };
      if (from('name'))
        Object.assign(data, { firstName: merged.firstName, lastName: merged.lastName });
      if (from('businessName')) data.businessName = merged.businessName;
      if (from('email')) data.email = merged.email;
      if (from('phone')) data.phone = merged.phone;
      if (from('address')) {
        Object.assign(data, {
          addressLine1: merged.addressLine1,
          addressLine2: merged.addressLine2,
          city: merged.city,
          state: merged.state,
          postalCode: merged.postalCode,
        });
      }
      if (from('dateOfBirth')) data.dateOfBirth = merged.dateOfBirth;
      if (from('source'))
        Object.assign(data, { source: merged.source, sourceDetail: merged.sourceDetail });
      if (from('priority')) data.priority = merged.priority;
      if (from('owner') && merged.assignedUserId !== kept.assignedUserId) {
        Object.assign(data, { assignedUserId: merged.assignedUserId, assignedByRuleId: null });
      }
      await tx.lead.update({ where: { id }, data });

      // Every phone and email of both, but the kept primaries, as the kept lead's other contacts.
      const email = (data.email as string | undefined) ?? kept.email;
      const phone = data.phone === undefined ? kept.phone : (data.phone as string | null);
      const have = new Set([`EMAIL:${emailKey(email)}`, `PHONE:${phoneKey(phone)}`]);
      const others: { kind: 'EMAIL' | 'PHONE'; value: string; label: string | null }[] = [];
      const offer = (kind: 'EMAIL' | 'PHONE', value: string | null, label: string | null) => {
        if (!value) return;
        const key = `${kind}:${kind === 'EMAIL' ? emailKey(value) : (phoneKey(value) ?? value)}`;
        if (have.has(key)) return;
        have.add(key);
        others.push({ kind, value: kind === 'EMAIL' ? value.trim().toLowerCase() : value, label });
      };
      for (const c of kept.contactPoints) offer(c.kind, c.value, c.label);
      offer('EMAIL', kept.email, null);
      offer('PHONE', kept.phone, null);
      offer('EMAIL', merged.email, null);
      offer('PHONE', merged.phone, null);
      for (const c of merged.contactPoints) offer(c.kind, c.value, c.label);
      await tx.leadContactPoint.deleteMany({ where: { businessId, leadId: id } });
      if (others.length) {
        await tx.leadContactPoint.createMany({
          data: others.slice(0, MAX_OTHER_CONTACTS).map((c, position) => ({
            businessId,
            leadId: id,
            ...c,
            position,
          })),
        });
      }
      // The other lead's services and tags join the kept lead's.
      const [services, tags] = await Promise.all([
        tx.leadService.findMany({
          where: { businessId, leadId: merged.id },
          select: { serviceId: true },
        }),
        tx.leadTag.findMany({ where: { businessId, leadId: merged.id }, select: { tagId: true } }),
      ]);
      if (services.length) {
        await tx.leadService.createMany({
          data: services.map((s) => ({ businessId, leadId: id, serviceId: s.serviceId })),
          skipDuplicates: true,
        });
      }
      if (tags.length) {
        await tx.leadTag.createMany({
          data: tags.map((t) => ({
            businessId,
            leadId: id,
            tagId: t.tagId,
            addedByUserId: actor.userId,
          })),
          skipDuplicates: true,
        });
      }
      // The merged lead: archived, linked to the kept one (final), its open sequences stopped.
      const now = new Date();
      await tx.lead.update({
        where: { id: merged.id },
        data: {
          mergedIntoLeadId: id,
          mergedAt: now,
          mergedByUserId: actor.userId,
          archivedAt: now,
          archivedByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await tx.leadSequenceRun.updateMany({
        where: { businessId, leadId: merged.id, stoppedAt: null },
        data: { stoppedAt: now, stopReason: 'Merged' },
      });
      // Both histories say what happened, with the other's number (a STATUS_CHANGED row carries the
      // lead's status, unchanged here; the label reads the merge from its metadata).
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: id,
          kind: 'STATUS_CHANGED',
          status: kept.status,
          actorUserId: actor.userId,
          metadata: { mergedFrom: `LD-${merged.number}` },
        },
      });
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: merged.id,
          kind: 'STATUS_CHANGED',
          status: merged.status,
          actorUserId: actor.userId,
          metadata: { mergedInto: `LD-${kept.number}` },
        },
      });
      await this.audit.logIn(
        tx,
        'lead.merged',
        { type: 'lead', id },
        {
          mergedLeadId: merged.id,
          taken: Object.keys(body.take).filter((k) => from(k)),
        },
      );
      return loadProfile(tx, businessId, actor, id, { unrestricted: true });
    });
  }
}
