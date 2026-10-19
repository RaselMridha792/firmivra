import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  ComplianceApplicabilityRule,
  ComplianceApplicabilityRulePage,
  ComplianceApplicabilityRulesQuery,
  ComplianceClientRef,
  ComplianceDeadline,
  ComplianceOk,
  ComplianceRuleEvaluation,
  ComplianceSettings,
  ComplianceSuggestion,
  ComplianceSuggestionPage,
  ComplianceSuggestionsQuery,
  ConfirmSuggestionRequest,
  CreateApplicabilityRuleRequest,
  DismissSuggestionRequest,
  GenerateSuggestionsRequest,
  GenerateSuggestionsResult,
  UpdateApplicabilityRuleRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { checkAssignee, isUniqueViolation, memberNames } from '../workspaces/common.js';
import { ComplianceDeadlineActionsService } from './compliance-deadline-actions.service.js';
import {
  type ComplianceActor,
  clientReach,
  clientRefSelect,
  loadSettings,
  memberRefOf,
  remindersOf,
  toClientRef,
  txOf,
} from './compliance.mappers.js';
import {
  adjustForHoliday,
  day,
  errors,
  inFirm,
  isoDay,
  mapComplianceDbError,
  occurrences,
  todayOf,
  toDay,
} from './compliance.shared.js';

const ruleInclude = {
  calendarEntry: { select: { id: true, name: true } },
  recurrence: { select: { id: true, name: true } },
} satisfies Prisma.ComplianceApplicabilityRuleInclude;
type RuleRow = Prisma.ComplianceApplicabilityRuleGetPayload<{ include: typeof ruleInclude }>;

/** Clients a generation looks at, and how long its transaction may run. */
const GENERATE_CLIENTS = 2_000;
const GENERATE_LIMITS = { timeout: 30_000 } as const;
const EVALUATE_CLIENTS = 5_000;

function toRule(r: RuleRow): ComplianceApplicabilityRule {
  const target = r.calendarEntry
    ? { kind: 'CALENDAR_ENTRY' as const, ...r.calendarEntry }
    : { kind: 'RECURRENCE' as const, ...(r.recurrence as { id: string; name: string }) };
  return {
    id: r.id,
    name: r.name,
    target,
    outcome: r.outcome,
    entityTypes: r.entityTypes,
    states: r.states,
    services: r.services,
    excludeStatuses: r.excludeStatuses,
    priorYearLiabilityOverCents: r.priorYearLiabilityOverCents,
    criteria: (r.criteria ?? {}) as Record<string, unknown>,
    active: r.active,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

interface ClientFacts {
  id: string;
  displayName: string;
  clientNumber: number;
  accountType: string;
  status: string;
  profile: { entityType: string | null; state: string | null } | null;
  engagements: { service: { kind: string } }[];
}

type Decision =
  | { kind: 'MATCH'; reason: string }
  | { kind: 'REVIEW'; reason: string }
  | { kind: 'NO_MATCH' | 'EXCLUDED' };

/**
 * What a rule decides for a client, from the client's record. A rule never guesses: when the
 * client has no data for something the rule asks about (entity type, state, prior-year liability)
 * or the rule has conditions this firm's records cannot check (`criteria`), the client needs
 * review and nothing is generated silently.
 */
export function decide(
  rule: Pick<
    RuleRow,
    | 'name'
    | 'version'
    | 'entityTypes'
    | 'states'
    | 'services'
    | 'excludeStatuses'
    | 'priorYearLiabilityOverCents'
    | 'criteria'
  >,
  client: ClientFacts,
): Decision {
  const lower = (list: readonly string[]) => list.map((x) => x.toLowerCase());
  if (lower(rule.excludeStatuses).includes(client.status.toLowerCase())) {
    return { kind: 'EXCLUDED' };
  }
  const parts: string[] = [];
  const entity = client.profile?.entityType ?? null;
  if (rule.entityTypes.length > 0) {
    if (!entity)
      return { kind: 'REVIEW', reason: `${tag(rule)}: the client's entity type is not recorded` };
    if (!lower(rule.entityTypes).includes(entity.toLowerCase())) return { kind: 'NO_MATCH' };
    parts.push(`entity ${entity}`);
  }
  const state = client.profile?.state ?? null;
  if (rule.states.length > 0) {
    if (!state)
      return { kind: 'REVIEW', reason: `${tag(rule)}: the client's state is not recorded` };
    if (!rule.states.includes(state.toUpperCase())) return { kind: 'NO_MATCH' };
    parts.push(`state ${state.toUpperCase()}`);
  }
  if (rule.services.length > 0) {
    const kinds = client.engagements.map((e) => e.service.kind);
    const hit = rule.services.find((s) => kinds.includes(s));
    if (!hit) return { kind: 'NO_MATCH' };
    parts.push(`service ${hit}`);
  }
  if (rule.priorYearLiabilityOverCents !== null) {
    return {
      kind: 'REVIEW',
      reason: `${tag(rule)}: the client's prior-year tax liability is not recorded`,
    };
  }
  const criteria = Object.keys((rule.criteria ?? {}) as object);
  if (criteria.length > 0) {
    return {
      kind: 'REVIEW',
      reason: `${tag(rule)}: staff must check ${criteria.slice(0, 5).join(', ')}`,
    };
  }
  return {
    kind: 'MATCH',
    reason: `${tag(rule)} applies${parts.length ? `: ${parts.join(', ')}` : ''}`,
  };
}

const tag = (rule: { name: string; version: number }) =>
  `Rule "${rule.name.slice(0, 80)}" v${rule.version}`;

/**
 * Applicability rules (Frame 3) and the suggestions queue: which clients get, or are only
 * suggested, a library entry's or a recurring definition's deadline. Government dates are never
 * assigned to everyone: a rule suggests (or, as APPLY, makes the deadline) only for clients it
 * matches, and flags the rest for review. Staff read the queue and confirm or dismiss for the
 * clients they reach; Owner and Admin manage the rules.
 */
@Injectable()
export class ComplianceRulesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly deadlines: ComplianceDeadlineActionsService,
  ) {}

  // ---------- Rules ----------

  async list(
    businessId: string,
    q: z.output<typeof ComplianceApplicabilityRulesQuery>,
  ): Promise<ComplianceApplicabilityRulePage> {
    const db = this.tenantPrisma.db;
    const where: Prisma.ComplianceApplicabilityRuleWhereInput = {
      businessId,
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.calendarEntryId ? { calendarEntryId: q.calendarEntryId } : {}),
      ...(q.recurrenceId ? { recurrenceId: q.recurrenceId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.complianceApplicabilityRule.findMany({
        where,
        include: ruleInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceApplicabilityRule.count({ where }),
    ]);
    return { items: rows.map(toRule), total, page: q.page, pageSize: q.pageSize };
  }

  async get(businessId: string, id: string): Promise<ComplianceApplicabilityRule> {
    const row = await this.tenantPrisma.db.complianceApplicabilityRule.findFirst({
      where: { businessId, id },
      include: ruleInclude,
    });
    if (!row) throw errors.notFound();
    return toRule(row);
  }

  private async checkTarget(
    tx: TxClient,
    businessId: string,
    target: { calendarEntryId?: string | undefined; recurrenceId?: string | undefined },
  ) {
    if (target.calendarEntryId) {
      const entry = await tx.complianceCalendarEntry.findFirst({
        where: { businessId, id: target.calendarEntryId },
        select: { id: true },
      });
      if (!entry) throw errors.notFound();
    }
    if (target.recurrenceId) {
      const rec = await tx.complianceRecurrence.findFirst({
        where: { businessId, id: target.recurrenceId },
        select: { isTemplate: true },
      });
      if (!rec) throw errors.notFound();
      if (rec.isTemplate) throw errors.recurrenceState('A template makes no deadlines');
    }
  }

  async create(
    businessId: string,
    actor: ComplianceActor,
    body: z.output<typeof CreateApplicabilityRuleRequest>,
  ): Promise<ComplianceApplicabilityRule> {
    try {
      const row = await inFirm(this.database, businessId, async (tx) => {
        const target =
          body.target.kind === 'CALENDAR_ENTRY'
            ? { calendarEntryId: body.target.id }
            : { recurrenceId: body.target.id };
        await this.checkTarget(tx, businessId, target);
        const created = await tx.complianceApplicabilityRule.create({
          data: {
            businessId,
            name: body.name,
            calendarEntryId: target.calendarEntryId ?? null,
            recurrenceId: target.recurrenceId ?? null,
            outcome: body.outcome,
            entityTypes: body.entityTypes,
            states: body.states,
            services: body.services,
            excludeStatuses: body.excludeStatuses,
            priorYearLiabilityOverCents: body.priorYearLiabilityOverCents ?? null,
            criteria: body.criteria as Prisma.InputJsonValue,
            active: body.active,
            createdByUserId: actor.userId,
          },
          include: ruleInclude,
        });
        await this.audit.logIn(
          tx,
          'compliance.rule.created',
          { type: 'compliance_rule', id: created.id },
          { outcome: body.outcome },
        );
        return created;
      });
      return toRule(row);
    } catch (error) {
      return mapComplianceDbError(error);
    }
  }

  async update(
    businessId: string,
    id: string,
    body: z.output<typeof UpdateApplicabilityRuleRequest>,
  ): Promise<ComplianceApplicabilityRule> {
    try {
      const row = await inFirm(this.database, businessId, async (tx) => {
        const found = await tx.complianceApplicabilityRule.findFirst({
          where: { businessId, id },
          select: { id: true },
        });
        if (!found) throw errors.notFound();
        // The database raises the rule's version when anything that decides a match changes.
        const updated = await tx.complianceApplicabilityRule.update({
          where: { businessId_id: { businessId, id } },
          data: {
            ...body,
            criteria:
              body.criteria === undefined ? undefined : (body.criteria as Prisma.InputJsonValue),
          },
          include: ruleInclude,
        });
        await this.audit.logIn(
          tx,
          'compliance.rule.updated',
          { type: 'compliance_rule', id },
          { fields: Object.keys(body).sort(), version: updated.version },
        );
        return updated;
      });
      return toRule(row);
    } catch (error) {
      return mapComplianceDbError(error);
    }
  }

  private clientsOf(tx: TxClient, businessId: string, actor: ComplianceActor, take: number) {
    return tx.client.findMany({
      where: { businessId, archivedAt: null, ...clientReach(actor) },
      select: {
        ...clientRefSelect,
        status: true,
        profile: { select: { entityType: true, state: true } },
        engagements: {
          where: { status: 'ACTIVE' },
          select: { service: { select: { kind: true } } },
        },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take,
    });
  }

  /** Which of the caller's clients the rule matches. Writes nothing. */
  async evaluate(
    businessId: string,
    actor: ComplianceActor,
    id: string,
  ): Promise<ComplianceRuleEvaluation> {
    const db = this.tenantPrisma.db;
    const rule = await db.complianceApplicabilityRule.findFirst({
      where: { businessId, id },
      include: ruleInclude,
    });
    if (!rule) throw errors.notFound();
    const clients = await this.clientsOf(txOf(db), businessId, actor, EVALUATE_CLIENTS);
    const matching: ComplianceClientRef[] = [];
    const review: { client: ComplianceClientRef; reason: string }[] = [];
    let matchingCount = 0;
    let reviewCount = 0;
    let excluded = 0;
    for (const c of clients) {
      const d = decide(rule, c);
      if (d.kind === 'MATCH') {
        matchingCount += 1;
        if (matching.length < 100) matching.push(toClientRef(c));
      } else if (d.kind === 'REVIEW') {
        reviewCount += 1;
        if (review.length < 100) review.push({ client: toClientRef(c), reason: d.reason });
      } else if (d.kind === 'EXCLUDED') excluded += 1;
    }
    await this.audit.log(
      'compliance.rule.evaluated',
      { type: 'compliance_rule', id },
      { matching: matchingCount, needsReview: reviewCount },
    );
    return {
      ruleId: id,
      ruleVersion: rule.version,
      matchingCount,
      matching,
      needsReviewCount: reviewCount,
      needsReview: review,
      excludedCount: excluded,
    };
  }

  // ---------- Suggestions ----------

  private suggestionOf(
    r: Prisma.ComplianceApplicabilityRecordGetPayload<{ include: typeof recordInclude }>,
    names: Map<string, string>,
  ): ComplianceSuggestion {
    return {
      id: r.id,
      client: toClientRef(r.client),
      rule: { id: r.rule.id, name: r.rule.name, version: r.ruleVersion },
      name: r.rule.calendarEntry?.name ?? r.rule.recurrence?.name ?? r.rule.name,
      dueOn: day(r.dueOn) as string,
      decision: r.decision,
      reason: r.reason,
      deadlineId: r.deadlineId,
      decidedBy: memberRefOf(names, r.decidedByUserId),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async suggestions(
    businessId: string,
    actor: ComplianceActor,
    q: z.output<typeof ComplianceSuggestionsQuery>,
  ): Promise<ComplianceSuggestionPage> {
    const db = this.tenantPrisma.db;
    const where: Prisma.ComplianceApplicabilityRecordWhereInput = {
      businessId,
      client: { archivedAt: null, ...clientReach(actor) },
      decision: q.decision === 'OPEN' ? { in: ['SUGGESTED', 'NEEDS_REVIEW'] } : q.decision,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.ruleId ? { ruleId: q.ruleId } : {}),
    };
    const [rows, total] = await Promise.all([
      db.complianceApplicabilityRecord.findMany({
        where,
        include: recordInclude,
        orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceApplicabilityRecord.count({ where }),
    ]);
    const names = await memberNames(
      txOf(db),
      businessId,
      rows.map((r) => r.decidedByUserId),
    );
    await this.audit.log(
      'compliance.suggestions.listed',
      { type: 'compliance' },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => this.suggestionOf(r, names)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Runs a rule for one due date over the caller's clients: each match is suggested (or, for an
   * APPLY rule, gets its deadline at once) and each client needing review is flagged. A client
   * that already has a record for the rule and date is left alone, so running it again adds nothing.
   */
  async generate(
    businessId: string,
    actor: ComplianceActor,
    body: z.output<typeof GenerateSuggestionsRequest>,
  ): Promise<GenerateSuggestionsResult> {
    try {
      return await this.database.withScope(
        { kind: 'business', businessId },
        async (tx) => {
          const rule = await tx.complianceApplicabilityRule.findFirst({
            where: { businessId, id: body.ruleId },
            include: {
              calendarEntry: { include: { calendar: true } },
              recurrence: true,
            },
          });
          if (!rule) throw errors.notFound();
          if (!rule.active) throw errors.ruleInactive();
          const target = await this.target(rule, body.dueOn);
          const settings = await loadSettings(tx, businessId);
          const clients = await this.clientsOf(tx, businessId, actor, GENERATE_CLIENTS);
          // A client that already has this deadline for this date needs no record.
          const have = new Set(
            (
              await tx.complianceDeadline.findMany({
                where: {
                  businessId,
                  ...(rule.calendarEntryId
                    ? { calendarEntryId: rule.calendarEntryId }
                    : { recurrenceId: rule.recurrenceId }),
                  OR: [
                    { statutoryDueOn: target.statutoryOn },
                    { statutoryDueOn: null, dueOn: target.statutoryOn },
                  ],
                },
                select: { clientId: true },
              })
            ).map((r) => r.clientId),
          );
          const existing = new Set(
            (
              await tx.complianceApplicabilityRecord.findMany({
                where: { businessId, ruleId: rule.id, dueOn: target.statutoryOn },
                select: { clientId: true },
              })
            ).map((r) => r.clientId),
          );
          const result = { suggested: 0, needsReview: 0, applied: 0, alreadyDecided: 0 };
          for (const c of clients) {
            const d = decide(rule, c);
            if (d.kind !== 'MATCH' && d.kind !== 'REVIEW') continue;
            if (existing.has(c.id) || have.has(c.id)) {
              result.alreadyDecided += 1;
              continue;
            }
            if (d.kind === 'REVIEW') {
              await tx.complianceApplicabilityRecord.create({
                data: {
                  businessId,
                  clientId: c.id,
                  ruleId: rule.id,
                  ruleVersion: rule.version,
                  dueOn: target.statutoryOn,
                  decision: 'NEEDS_REVIEW',
                  reason: d.reason.slice(0, 500),
                },
              });
              result.needsReview += 1;
            } else if (rule.outcome === 'APPLY') {
              const client = await tx.client.findFirstOrThrow({
                where: { businessId, id: c.id },
                select: { id: true, assignedUserId: true },
              });
              const deadlineId = await this.deadlines.makeFromRule(
                tx,
                businessId,
                actor,
                settings,
                { client, ...target.deadline(settings), applicabilityReason: d.reason },
              );
              await tx.complianceApplicabilityRecord.create({
                data: {
                  businessId,
                  clientId: c.id,
                  ruleId: rule.id,
                  ruleVersion: rule.version,
                  dueOn: target.statutoryOn,
                  decision: 'CONFIRMED',
                  reason: d.reason.slice(0, 500),
                  deadlineId,
                  decidedByUserId: actor.userId,
                  decidedAt: new Date(),
                },
              });
              result.applied += 1;
            } else {
              await tx.complianceApplicabilityRecord.create({
                data: {
                  businessId,
                  clientId: c.id,
                  ruleId: rule.id,
                  ruleVersion: rule.version,
                  dueOn: target.statutoryOn,
                  decision: 'SUGGESTED',
                  reason: d.reason.slice(0, 500),
                },
              });
              result.suggested += 1;
            }
          }
          await tx.complianceLog.create({
            data: {
              businessId,
              kind: 'GENERATE',
              outcome: 'SUCCESS',
              calendarId: rule.calendarEntry?.calendarId ?? null,
              recurrenceId: rule.recurrenceId,
              message: 'A rule was run for a due date',
              details: { ruleId: rule.id, ...result },
              actorUserId: actor.userId,
            },
          });
          await this.audit.logIn(
            tx,
            'compliance.suggestions.generated',
            { type: 'compliance_rule', id: rule.id },
            result,
          );
          return { ruleId: rule.id, dueOn: isoDay(target.statutoryOn), ...result };
        },
        GENERATE_LIMITS,
      );
    } catch (error) {
      return mapComplianceDbError(error);
    }
  }

  /** The statutory date and the deadline's fields from the rule's entry or recurrence. */
  private async target(
    rule: Prisma.ComplianceApplicabilityRuleGetPayload<{
      include: { calendarEntry: { include: { calendar: true } }; recurrence: true };
    }>,
    asked: string | undefined,
  ) {
    const entry = rule.calendarEntry;
    const rec = rule.recurrence;
    if (entry) {
      // A fixed date is the library's; any other entry needs the date given (never invented).
      const statutory = entry.dueOn ?? (asked ? toDay(asked) : null);
      if (!statutory) throw errors.dueDateRequired();
      if (entry.dueOn && asked && asked !== day(entry.dueOn)) {
        throw errors.invalid('dueOn', "The library entry's date is fixed: leave the date out");
      }
      const cal = entry.calendar;
      return {
        statutoryOn: statutory,
        deadline: (settings: ComplianceSettings) => ({
          name: entry.name,
          type: entry.type,
          source: cal.family === 'FIRM_INTERNAL' ? ('FIRM' as const) : ('GOVERNMENT' as const),
          description: entry.description,
          relatedForm: entry.form,
          agency: cal.authority,
          jurisdiction: cal.jurisdiction,
          state: cal.state,
          statutoryDueOn: statutory,
          dueOn: statutory,
          calendarEntryId: entry.id,
          recurrenceId: null,
          reminders: settings.defaultReminders,
          createTask: false,
          taskTemplateId: null,
        }),
      };
    }
    const r = rec as NonNullable<typeof rec>;
    if (r.isTemplate) throw errors.recurrenceState('A template makes no deadlines');
    let statutory = asked ? toDay(asked) : null;
    if (!statutory && r.startOn && r.frequency !== 'AUTHORITY_DEFINED') {
      statutory =
        occurrences(
          {
            frequency: r.frequency,
            interval: r.interval,
            repeatRule: r.repeatRule as never,
            startOn: r.startOn,
            endMode: r.endMode,
            endAfterCount: r.endAfterCount,
            endOn: r.endOn,
            holidayRule: r.holidayRule,
          },
          { count: 1, notBefore: todayOf() },
        )[0]?.statutoryOn ?? null;
    }
    if (!statutory) throw errors.dueDateRequired();
    return {
      statutoryOn: statutory,
      deadline: () => ({
        name: r.name,
        type: r.type,
        source: 'FIRM' as const,
        description: r.description,
        relatedForm: r.relatedForm,
        agency: r.agency,
        jurisdiction: r.jurisdiction,
        state: r.state,
        statutoryDueOn: statutory,
        dueOn: adjustForHoliday(statutory, r.holidayRule),
        calendarEntryId: null,
        recurrenceId: r.id,
        assignedUserId: r.assignedUserId,
        clientVisible: r.clientVisible,
        reminders: remindersOf(r.reminders),
        createTask: r.createTask,
        taskTemplateId: r.taskTemplateId,
      }),
    };
  }

  /** A suggestion the caller reaches and that still waits for a decision. */
  private async open(tx: TxClient, businessId: string, actor: ComplianceActor, id: string) {
    const record = await tx.complianceApplicabilityRecord.findFirst({
      where: { businessId, id, client: { archivedAt: null, ...clientReach(actor) } },
      include: {
        rule: {
          include: {
            calendarEntry: { include: { calendar: true } },
            recurrence: true,
          },
        },
      },
    });
    if (!record) throw errors.notFound();
    if (record.decision === 'CONFIRMED' || record.decision === 'DISMISSED') {
      throw errors.suggestionState('This suggestion has already been decided');
    }
    return record;
  }

  async confirm(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof ConfirmSuggestionRequest>,
  ): Promise<ComplianceDeadline> {
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const record = await this.open(tx, businessId, actor, id);
        const settings = await loadSettings(tx, businessId);
        const target = await this.target(record.rule, day(record.dueOn) as string);
        const client = await tx.client.findFirstOrThrow({
          where: { businessId, id: record.clientId },
          select: { id: true, assignedUserId: true },
        });
        // A person named here must be assignable (a rule's own default is only used when it is).
        if (body.assignedUserId) {
          await checkAssignee(tx, businessId, body.assignedUserId, client);
        }
        const made = target.deadline(settings);
        const deadlineId = await this.deadlines.makeFromRule(tx, businessId, actor, settings, {
          client,
          ...made,
          ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
          ...(body.priority ? { priority: body.priority } : {}),
          ...(body.clientVisible !== undefined ? { clientVisible: body.clientVisible } : {}),
          applicabilityReason: record.reason,
        });
        await tx.complianceApplicabilityRecord.update({
          where: { id },
          data: {
            decision: 'CONFIRMED',
            deadlineId,
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
          },
        });
        await this.audit.logIn(
          tx,
          'compliance.suggestion.confirmed',
          { type: 'compliance_suggestion', id },
          { clientId: record.clientId, deadlineId },
        );
        return this.deadlines.detailIn(tx, businessId, actor, deadlineId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw errors.duplicate('This client already has that deadline for that date');
      }
      return mapComplianceDbError(error);
    }
  }

  async dismiss(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof DismissSuggestionRequest>,
  ): Promise<ComplianceOk> {
    await inFirm(this.database, businessId, async (tx) => {
      const record = await this.open(tx, businessId, actor, id);
      await tx.complianceApplicabilityRecord.update({
        where: { id },
        data: {
          decision: 'DISMISSED',
          reason: `Dismissed: ${body.reason}`.slice(0, 500),
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
        },
      });
      await this.audit.logIn(
        tx,
        'compliance.suggestion.dismissed',
        { type: 'compliance_suggestion', id },
        { clientId: record.clientId },
      );
    });
    return { ok: true };
  }
}

const recordInclude = {
  client: { select: clientRefSelect },
  rule: {
    select: {
      id: true,
      name: true,
      calendarEntry: { select: { name: true } },
      recurrence: { select: { name: true } },
    },
  },
} satisfies Prisma.ComplianceApplicabilityRecordInclude;
