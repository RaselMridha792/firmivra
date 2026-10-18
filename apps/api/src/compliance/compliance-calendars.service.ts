import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import {
  type ComplianceCalendar,
  type ComplianceCalendarDiff,
  type ComplianceCalendarEntry,
  type ComplianceCalendarPage,
  type ComplianceCalendarRow,
  type ComplianceCalendarsQuery,
  ComplianceFormulaRule,
  type ComplianceOk,
  type ImportComplianceCalendarRequest,
  type UpdateComplianceCalendarEntryRequest,
  type UpdateComplianceCalendarRequest,
  type ComplianceCalendarEntryInput,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { isForeignKeyViolation, isUniqueViolation } from '../workspaces/common.js';
import { diffEntries, type DiffEntryData } from './compliance.diff.js';
import { type ComplianceActor, iso, loadSettings, txOf } from './compliance.mappers.js';
import {
  addDays,
  day,
  errors,
  inFirm,
  mapComplianceDbError,
  todayOf,
  toDay,
} from './compliance.shared.js';

type Import = z.output<typeof ImportComplianceCalendarRequest>;
type EntryInput = z.output<typeof ComplianceCalendarEntryInput>;
type Db = TxClient;

const entryOrder: Prisma.ComplianceCalendarEntryOrderByWithRelationInput[] = [
  { name: 'asc' },
  { dueOn: { sort: 'asc', nulls: 'last' } },
  { id: 'asc' },
];

function toEntry(e: {
  id: string;
  name: string;
  type: ComplianceCalendarEntry['type'];
  form: string | null;
  description: string | null;
  ruleKind: ComplianceCalendarEntry['ruleKind'];
  dueOn: Date | null;
  rule: unknown;
}): ComplianceCalendarEntry {
  const rule = ComplianceFormulaRule.safeParse(e.rule);
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    form: e.form,
    description: e.description,
    ruleKind: e.ruleKind,
    dueOn: day(e.dueOn),
    rule: rule.success ? rule.data : null,
  };
}

const diffData = (e: ComplianceCalendarEntry): DiffEntryData => ({ ...e });

const inputData = (e: EntryInput): DiffEntryData => ({
  name: e.name,
  form: e.form ?? null,
  type: e.type,
  description: e.description ?? null,
  ruleKind: e.ruleKind,
  dueOn: e.ruleKind === 'FIXED_DATE' ? e.dueOn : null,
  rule: e.ruleKind === 'FORMULA' ? e.rule : null,
});

const entryData = (businessId: string, calendarId: string, e: EntryInput) => ({
  businessId,
  calendarId,
  name: e.name,
  type: e.type,
  form: e.form ?? null,
  description: e.description ?? null,
  ruleKind: e.ruleKind,
  dueOn: e.ruleKind === 'FIXED_DATE' ? toDay(e.dueOn) : null,
  rule: e.ruleKind === 'FORMULA' ? (e.rule as Prisma.InputJsonValue) : undefined,
});

/**
 * The firm's Calendar Library: versioned official calendars. Importing makes a DRAFT (a failed
 * import never touches the published version and is logged); a DRAFT is verified, then published,
 * which supersedes the published version of the same family, authority, state and year (kept for
 * rollback). Entries change only while the version is a DRAFT; a date is never invented, so an
 * entry with no date blocks verifying. Staff read, Owner and Admin change. Imports, verifying,
 * publishing and rollbacks are written to the compliance log and the audit log.
 */
@Injectable()
export class ComplianceCalendarsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private rowOf(
    c: {
      id: string;
      family: ComplianceCalendarRow['family'];
      authority: string;
      jurisdiction: ComplianceCalendarRow['jurisdiction'];
      state: string | null;
      effectiveYear: number;
      version: number;
      name: string;
      sourceUrl: string;
      retrievedAt: Date | null;
      verifiedAt: Date | null;
      status: ComplianceCalendarRow['status'];
      publishedAt: Date | null;
      createdAt: Date;
    },
    counts: { entries: number; needsVerification: number },
    staleDays: number,
    today: Date,
  ): ComplianceCalendarRow {
    return {
      id: c.id,
      family: c.family,
      authority: c.authority,
      jurisdiction: c.jurisdiction,
      state: c.state,
      effectiveYear: c.effectiveYear,
      version: c.version,
      name: c.name,
      sourceUrl: c.sourceUrl,
      retrievedAt: iso(c.retrievedAt),
      verifiedAt: iso(c.verifiedAt),
      status: c.status,
      publishedAt: iso(c.publishedAt),
      entryCount: counts.entries,
      needsVerificationCount: counts.needsVerification,
      stale:
        c.status === 'PUBLISHED' &&
        (c.verifiedAt === null || c.verifiedAt < addDays(today, -staleDays)),
      createdAt: c.createdAt.toISOString(),
    };
  }

  private async counts(db: Db, businessId: string, ids: string[]) {
    const groups = await db.complianceCalendarEntry.groupBy({
      by: ['calendarId', 'ruleKind'],
      where: { businessId, calendarId: { in: ids } },
      _count: { _all: true },
    });
    const out = new Map<string, { entries: number; needsVerification: number }>();
    for (const g of groups) {
      const c = out.get(g.calendarId) ?? { entries: 0, needsVerification: 0 };
      c.entries += g._count._all;
      if (g.ruleKind === 'NEEDS_VERIFICATION') c.needsVerification += g._count._all;
      out.set(g.calendarId, c);
    }
    return out;
  }

  async list(
    businessId: string,
    q: z.output<typeof ComplianceCalendarsQuery>,
  ): Promise<ComplianceCalendarPage> {
    const db = this.tenantPrisma.db;
    const where: Prisma.ComplianceCalendarWhereInput = {
      businessId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.family ? { family: q.family } : {}),
      ...(q.year ? { effectiveYear: q.year } : {}),
      ...(q.state ? { state: q.state } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { authority: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, settings] = await Promise.all([
      db.complianceCalendar.findMany({
        where,
        orderBy: [
          { effectiveYear: 'desc' },
          { authority: 'asc' },
          { version: 'desc' },
          { id: 'asc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceCalendar.count({ where }),
      loadSettings(txOf(db), businessId),
    ]);
    const counts = await this.counts(
      txOf(db),
      businessId,
      rows.map((r) => r.id),
    );
    const today = todayOf();
    return {
      items: rows.map((r) =>
        this.rowOf(
          r,
          counts.get(r.id) ?? { entries: 0, needsVerification: 0 },
          settings.staleCalendarDays,
          today,
        ),
      ),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async load(db: Db, businessId: string, id: string): Promise<ComplianceCalendar> {
    const typed = db;
    const c = await typed.complianceCalendar.findFirst({
      where: { businessId, id },
      include: { entries: { orderBy: entryOrder } },
    });
    if (!c) throw errors.notFound();
    const settings = await loadSettings(typed, businessId);
    const entries = c.entries.map(toEntry);
    return {
      ...this.rowOf(
        c,
        {
          entries: entries.length,
          needsVerification: entries.filter((e) => e.ruleKind === 'NEEDS_VERIFICATION').length,
        },
        settings.staleCalendarDays,
        todayOf(),
      ),
      entries,
    };
  }

  get(businessId: string, id: string): Promise<ComplianceCalendar> {
    return this.load(txOf(this.tenantPrisma.db), businessId, id);
  }

  // ---------- Import and compare ----------

  /** The entries of the published version of a family, authority, state and year, with their ids. */
  private async publishedOf(
    db: Db,
    businessId: string,
    key: Pick<Import, 'family' | 'authority' | 'effectiveYear'> & {
      state?: string | null | undefined;
    },
  ) {
    return db.complianceCalendar.findFirst({
      where: {
        businessId,
        family: key.family,
        authority: key.authority,
        state: key.state ?? null,
        effectiveYear: key.effectiveYear,
        status: 'PUBLISHED',
      },
      include: { entries: { orderBy: entryOrder } },
    });
  }

  /** Changed or removed entries whose deadlines the firm overrode (they need a review before publishing). */
  private async overrides(
    db: Db,
    businessId: string,
    entryIds: string[],
  ): Promise<Map<string, number>> {
    if (entryIds.length === 0) return new Map();
    const groups = await db.complianceDeadline.groupBy({
      by: ['calendarEntryId'],
      where: {
        businessId,
        calendarEntryId: { in: entryIds },
        dueOverridden: true,
        archivedAt: null,
      },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.calendarEntryId as string, g._count._all]));
  }

  private async diff(
    db: Db,
    businessId: string,
    from: ComplianceCalendarDiff['from'],
    before: DiffEntryData[],
    to: ComplianceCalendarDiff['to'],
    after: DiffEntryData[],
  ): Promise<ComplianceCalendarDiff> {
    const rows = diffEntries(before, after);
    const flagged = rows.filter((r) => r.change === 'CHANGED' || r.change === 'REMOVED');
    const overridden = await this.overrides(
      db,
      businessId,
      flagged.flatMap((r) => (r.before?.id ? [r.before.id] : [])),
    );
    const side = (e: DiffEntryData | null) =>
      e && {
        type: e.type as ComplianceCalendarEntry['type'],
        description: e.description,
        ruleKind: e.ruleKind as ComplianceCalendarEntry['ruleKind'],
        dueOn: e.dueOn,
        rule: ComplianceFormulaRule.safeParse(e.rule).data ?? null,
      };
    const entries = rows.map((r) => ({
      change: r.change,
      name: ((r.after ?? r.before) as DiffEntryData).name,
      form: ((r.after ?? r.before) as DiffEntryData).form,
      before: side(r.before),
      after: side(r.after),
      overriddenDeadlines: r.before?.id ? (overridden.get(r.before.id) ?? 0) : 0,
    }));
    const count = (c: string) => rows.filter((r) => r.change === c).length;
    return {
      from,
      to,
      counts: {
        added: count('ADDED'),
        changed: count('CHANGED'),
        removed: count('REMOVED'),
        unchanged: count('UNCHANGED'),
      },
      conflicts: entries.filter((e) => e.overriddenDeadlines > 0).length,
      entries,
    };
  }

  private ref(c: {
    id: string;
    name: string;
    version: number;
    status: ComplianceCalendarRow['status'];
    effectiveYear: number;
  }) {
    return {
      id: c.id,
      name: c.name,
      version: c.version,
      status: c.status,
      effectiveYear: c.effectiveYear,
    };
  }

  /** What an import would change against the published version of the same family, authority, state and year. */
  async previewImport(businessId: string, body: Import): Promise<ComplianceCalendarDiff> {
    const db = this.tenantPrisma.db;
    const published = await this.publishedOf(txOf(db), businessId, body);
    const before = published ? published.entries.map((e) => ({ ...diffData(toEntry(e)) })) : [];
    return this.diff(
      txOf(db),
      businessId,
      published ? this.ref(published) : null,
      before,
      null,
      body.entries.map(inputData),
    );
  }

  async compare(businessId: string, id: string, otherId: string): Promise<ComplianceCalendarDiff> {
    const db = this.tenantPrisma.db;
    const [to, from] = await Promise.all([
      db.complianceCalendar.findFirst({
        where: { businessId, id },
        include: { entries: { orderBy: entryOrder } },
      }),
      db.complianceCalendar.findFirst({
        where: { businessId, id: otherId },
        include: { entries: { orderBy: entryOrder } },
      }),
    ]);
    if (!to || !from) throw errors.notFound();
    return this.diff(
      txOf(db),
      businessId,
      this.ref(from),
      from.entries.map((e) => diffData(toEntry(e))),
      this.ref(to),
      to.entries.map((e) => diffData(toEntry(e))),
    );
  }

  /** Makes a new DRAFT version. A failure is logged and leaves the published version alone. */
  async importCalendar(
    businessId: string,
    actor: ComplianceActor,
    body: Import,
  ): Promise<ComplianceCalendar> {
    try {
      const id = await inFirm(this.database, businessId, async (tx) => {
        const last = await tx.complianceCalendar.aggregate({
          where: {
            businessId,
            family: body.family,
            authority: body.authority,
            state: body.state ?? null,
            effectiveYear: body.effectiveYear,
          },
          _max: { version: true },
        });
        const created = await tx.complianceCalendar.create({
          data: {
            businessId,
            family: body.family,
            authority: body.authority,
            jurisdiction: body.jurisdiction,
            state: body.state ?? null,
            effectiveYear: body.effectiveYear,
            version: (last._max.version ?? 0) + 1,
            name: body.name,
            sourceUrl: body.sourceUrl,
            retrievedAt: body.retrievedAt ? new Date(body.retrievedAt) : new Date(),
            createdByUserId: actor.userId,
          },
          select: { id: true, version: true },
        });
        await tx.complianceCalendarEntry.createMany({
          data: body.entries.map((e) => entryData(businessId, created.id, e)),
        });
        await tx.complianceLog.create({
          data: {
            businessId,
            kind: 'IMPORT',
            outcome: 'SUCCESS',
            calendarId: created.id,
            message: 'A calendar version was imported as a draft',
            details: { entries: body.entries.length, version: created.version },
            actorUserId: actor.userId,
          },
        });
        await this.audit.logIn(
          tx,
          'compliance.calendar.imported',
          { type: 'compliance_calendar', id: created.id },
          { entries: body.entries.length, version: created.version, family: body.family },
        );
        return created.id;
      });
      return await this.load(txOf(this.tenantPrisma.db), businessId, id);
    } catch (error) {
      await this.logFailure(
        businessId,
        actor,
        'IMPORT',
        'The calendar import failed; the published version is untouched',
      );
      if (isUniqueViolation(error)) {
        throw errors.duplicate(
          'A version with the same entries was imported at the same time: try again',
        );
      }
      return mapComplianceDbError(error);
    }
  }

  /** The failed attempt, in its own transaction so it is kept; never throws. */
  private async logFailure(
    businessId: string,
    actor: ComplianceActor,
    kind: 'IMPORT' | 'PUBLISH' | 'ROLLBACK',
    message: string,
    calendarId?: string,
  ) {
    try {
      await inFirm(this.database, businessId, (tx) =>
        tx.complianceLog.create({
          data: {
            businessId,
            kind,
            outcome: 'FAILED',
            calendarId: calendarId ?? null,
            message,
            actorUserId: actor.userId,
          },
        }),
      );
    } catch {
      // The log is best effort; the original error is the answer.
    }
  }

  // ---------- A draft ----------

  /** The calendar in DRAFT, or 404 / 409 CALENDAR_STATE. */
  private async draft(tx: TxClient, businessId: string, id: string) {
    const c = await tx.complianceCalendar.findFirst({
      where: { businessId, id },
      select: { id: true, status: true },
    });
    if (!c) throw errors.notFound();
    if (c.status !== 'DRAFT') {
      throw errors.calendarState(
        'Only a draft version can be changed: import a new version instead',
      );
    }
    return c;
  }

  async update(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof UpdateComplianceCalendarRequest>,
  ): Promise<ComplianceCalendar> {
    await this.guard(() =>
      inFirm(this.database, businessId, async (tx) => {
        await this.draft(tx, businessId, id);
        await tx.complianceCalendar.update({
          where: { businessId_id: { businessId, id } },
          data: {
            name: body.name,
            sourceUrl: body.sourceUrl,
            retrievedAt:
              body.retrievedAt === undefined
                ? undefined
                : body.retrievedAt
                  ? new Date(body.retrievedAt)
                  : null,
          },
        });
        await this.audit.logIn(
          tx,
          'compliance.calendar.updated',
          { type: 'compliance_calendar', id },
          { fields: Object.keys(body).sort() },
        );
      }),
    );
    return this.load(txOf(this.tenantPrisma.db), businessId, id);
  }

  async addEntry(
    businessId: string,
    id: string,
    body: EntryInput,
  ): Promise<ComplianceCalendarEntry> {
    return this.guard(
      () =>
        inFirm(this.database, businessId, async (tx) => {
          await this.draft(tx, businessId, id);
          const row = await tx.complianceCalendarEntry.create({
            data: entryData(businessId, id, body),
          });
          await this.audit.logIn(
            tx,
            'compliance.calendar.entry-added',
            { type: 'compliance_calendar', id },
            { entryId: row.id },
          );
          return toEntry(row);
        }),
      () => errors.duplicate('This calendar already has an entry with that name and date'),
    );
  }

  async updateEntry(
    businessId: string,
    id: string,
    entryId: string,
    body: z.output<typeof UpdateComplianceCalendarEntryRequest>,
  ): Promise<ComplianceCalendarEntry> {
    return this.guard(
      () =>
        inFirm(this.database, businessId, async (tx) => {
          await this.draft(tx, businessId, id);
          const current = await tx.complianceCalendarEntry.findFirst({
            where: { businessId, id: entryId, calendarId: id },
          });
          if (!current) throw errors.notFound();
          const kind = body.ruleKind ?? current.ruleKind;
          const dueOn = body.dueOn !== undefined ? body.dueOn : day(current.dueOn);
          const rule = body.rule !== undefined ? body.rule : toEntry(current).rule;
          if (kind === 'FIXED_DATE' && !dueOn)
            throw errors.invalid('dueOn', 'A fixed date needs its date');
          if (kind === 'FORMULA' && !rule) throw errors.invalid('rule', 'A formula needs its rule');
          const row = await tx.complianceCalendarEntry.update({
            where: { businessId_id: { businessId, id: entryId } },
            data: {
              name: body.name,
              type: body.type,
              form: body.form,
              description: body.description,
              ruleKind: kind,
              dueOn: kind === 'FIXED_DATE' && dueOn ? toDay(dueOn) : null,
              rule: kind === 'FORMULA' && rule ? (rule as Prisma.InputJsonValue) : Prisma.DbNull,
            },
          });
          await this.audit.logIn(
            tx,
            'compliance.calendar.entry-updated',
            { type: 'compliance_calendar', id },
            { entryId, fields: Object.keys(body).sort() },
          );
          return toEntry(row);
        }),
      () => errors.duplicate('This calendar already has an entry with that name and date'),
    );
  }

  async deleteEntry(businessId: string, id: string, entryId: string): Promise<ComplianceOk> {
    return this.guard(async () => {
      await inFirm(this.database, businessId, async (tx) => {
        await this.draft(tx, businessId, id);
        const { count } = await tx.complianceCalendarEntry.deleteMany({
          where: { businessId, id: entryId, calendarId: id },
        });
        if (count === 0) throw errors.notFound();
        await this.audit.logIn(
          tx,
          'compliance.calendar.entry-deleted',
          { type: 'compliance_calendar', id },
          { entryId },
        );
      });
      return { ok: true as const };
    });
  }

  // ---------- Status ----------

  async verify(
    businessId: string,
    actor: ComplianceActor,
    id: string,
  ): Promise<ComplianceCalendar> {
    await this.guard(() =>
      inFirm(this.database, businessId, async (tx) => {
        await this.draft(tx, businessId, id);
        const entries = await tx.complianceCalendarEntry.groupBy({
          by: ['ruleKind'],
          where: { businessId, calendarId: id },
          _count: { _all: true },
        });
        if (entries.length === 0) throw errors.noEntries();
        if (entries.some((e) => e.ruleKind === 'NEEDS_VERIFICATION')) {
          throw errors.entriesNeedVerification();
        }
        const { count } = await tx.complianceCalendar.updateMany({
          where: { businessId, id, status: 'DRAFT' },
          data: { status: 'VERIFIED', verifiedAt: new Date() },
        });
        if (count === 0) throw errors.calendarState('The calendar changed: try again');
        await tx.complianceLog.create({
          data: {
            businessId,
            kind: 'VERIFY',
            outcome: 'SUCCESS',
            calendarId: id,
            message: 'A calendar version was verified against its source',
            details: { entries: entries.reduce((n, e) => n + e._count._all, 0) },
            actorUserId: actor.userId,
          },
        });
        await this.audit.logIn(tx, 'compliance.calendar.verified', {
          type: 'compliance_calendar',
          id,
        });
      }),
    );
    return this.load(txOf(this.tenantPrisma.db), businessId, id);
  }

  /** Publishes a VERIFIED version, or (rollback) a SUPERSEDED one; the version in use is superseded. */
  private async publishVersion(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    from: 'VERIFIED' | 'SUPERSEDED',
  ): Promise<ComplianceCalendar> {
    const kind = from === 'VERIFIED' ? 'PUBLISH' : 'ROLLBACK';
    try {
      await this.guard(() =>
        inFirm(this.database, businessId, async (tx) => {
          const c = await tx.complianceCalendar.findFirst({
            where: { businessId, id },
            select: {
              id: true,
              status: true,
              family: true,
              authority: true,
              state: true,
              effectiveYear: true,
            },
          });
          if (!c) throw errors.notFound();
          if (c.status !== from) {
            throw errors.calendarState(
              from === 'VERIFIED'
                ? 'Verify the calendar before publishing it'
                : 'Only a version that was replaced can be rolled back to',
            );
          }
          const current = await tx.complianceCalendar.findFirst({
            where: {
              businessId,
              family: c.family,
              authority: c.authority,
              state: c.state,
              effectiveYear: c.effectiveYear,
              status: 'PUBLISHED',
            },
            select: { id: true },
          });
          if (current) {
            await tx.complianceCalendar.update({
              where: { businessId_id: { businessId, id: current.id } },
              data: { status: 'SUPERSEDED' },
            });
          }
          await tx.complianceCalendar.update({
            where: { businessId_id: { businessId, id } },
            data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: actor.userId },
          });
          await tx.complianceLog.create({
            data: {
              businessId,
              kind,
              outcome: 'SUCCESS',
              calendarId: id,
              message:
                kind === 'PUBLISH'
                  ? 'A calendar version was published'
                  : 'An earlier calendar version was published again',
              details: { supersededId: current?.id ?? null },
              actorUserId: actor.userId,
            },
          });
          await this.audit.logIn(
            tx,
            kind === 'PUBLISH'
              ? 'compliance.calendar.published'
              : 'compliance.calendar.rolled-back',
            { type: 'compliance_calendar', id },
            { supersededId: current?.id ?? null },
          );
        }),
      );
    } catch (error) {
      await this.logFailure(
        businessId,
        actor,
        kind,
        'The calendar could not be published; the published version is untouched',
        id,
      );
      throw error;
    }
    return this.load(txOf(this.tenantPrisma.db), businessId, id);
  }

  publish(businessId: string, actor: ComplianceActor, id: string) {
    return this.publishVersion(businessId, actor, id, 'VERIFIED');
  }

  rollback(businessId: string, actor: ComplianceActor, id: string) {
    return this.publishVersion(businessId, actor, id, 'SUPERSEDED');
  }

  async archive(businessId: string, id: string): Promise<ComplianceCalendar> {
    await this.guard(() =>
      inFirm(this.database, businessId, async (tx) => {
        const c = await tx.complianceCalendar.findFirst({
          where: { businessId, id },
          select: { status: true },
        });
        if (!c) throw errors.notFound();
        if (c.status === 'PUBLISHED' || c.status === 'ARCHIVED') {
          throw errors.calendarState(
            c.status === 'PUBLISHED'
              ? 'Publish another version before archiving this one'
              : 'This version is already archived',
          );
        }
        await tx.complianceCalendar.update({
          where: { businessId_id: { businessId, id } },
          data: { status: 'ARCHIVED' },
        });
        await this.audit.logIn(tx, 'compliance.calendar.archived', {
          type: 'compliance_calendar',
          id,
        });
      }),
    );
    return this.load(txOf(this.tenantPrisma.db), businessId, id);
  }

  /** The database's own rules (a version that left DRAFT, one published per year) as the contract's 409s. */
  private async guard<T>(work: () => Promise<T>, onUnique?: () => Error): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (onUnique) throw onUnique();
        throw errors.calendarState(
          'Another version is already published for this calendar and year',
        );
      }
      if (isForeignKeyViolation(error)) {
        throw errors.calendarState(
          'That entry is in use by a deadline, recurring definition or rule',
        );
      }
      return mapComplianceDbError(error);
    }
  }
}
