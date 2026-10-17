// Compliance & Deadlines: deadlines, the calendar library, recurring definitions, applicability
// rules and the suggestions queue. Every deadline is client X's; the library and the rules are
// the firm's.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef, SeedContext } from '../world.js';

const BASE = '/api/v1/business/compliance';

const tag = () => randomUUID().slice(0, 8);

type Deadline = Partial<{
  name: string;
  status: 'UPCOMING' | 'COMPLETED';
}>;

/** A deadline of client X, due far ahead so an extension or a task has room. */
const makeDeadline = async (ctx: SeedContext, over: Deadline = {}) => {
  const row = await ctx.tx.complianceDeadline.create({
    data: {
      businessId: ctx.businessId,
      clientId: await ctx.get('client'),
      name: over.name ?? `Fake deadline ${tag()}`,
      type: 'TAX_FILING',
      dueOn: new Date('2030-01-15T00:00:00.000Z'),
      status: over.status ?? 'UPCOMING',
      ...(over.status === 'COMPLETED' ? { completedAt: new Date('2030-01-01T00:00:00.000Z') } : {}),
    },
  });
  return row.id;
};

const calendar = (status: 'DRAFT' | 'VERIFIED' | 'SUPERSEDED'): RecordDef => ({
  async create({ tx, businessId }) {
    const stamp = new Date('2030-01-01T00:00:00.000Z');
    const row = await tx.complianceCalendar.create({
      data: {
        businessId,
        family: 'IRS_GENERAL',
        authority: `Fake authority ${tag()}`,
        jurisdiction: 'FEDERAL',
        effectiveYear: 2030,
        name: `Fake calendar ${tag()}`,
        sourceUrl: 'https://example.test/calendar',
        ...(status === 'DRAFT' ? {} : { verifiedAt: stamp }),
        ...(status === 'SUPERSEDED' ? { publishedAt: stamp } : {}),
      },
    });
    await tx.complianceCalendarEntry.create({
      data: {
        businessId,
        calendarId: row.id,
        name: 'Fake entry',
        type: 'TAX_FILING',
        ruleKind: 'FIXED_DATE',
        dueOn: new Date('2030-04-15T00:00:00.000Z'),
      },
    });
    if (status !== 'DRAFT') {
      await tx.complianceCalendar.update({ where: { id: row.id }, data: { status: 'VERIFIED' } });
    }
    if (status === 'SUPERSEDED') {
      await tx.complianceCalendar.update({ where: { id: row.id }, data: { status: 'PUBLISHED' } });
      await tx.complianceCalendar.update({ where: { id: row.id }, data: { status: 'SUPERSEDED' } });
    }
    return row.id;
  },
});

const recurrence = (status: 'ACTIVE' | 'PAUSED'): RecordDef => ({
  async create({ tx, businessId }) {
    const row = await tx.complianceRecurrence.create({
      data: {
        businessId,
        name: `Fake recurrence ${tag()}`,
        type: 'PAYROLL',
        frequency: 'MONTHLY',
        repeatRule: { dayOfMonth: 15 },
        startOn: new Date('2030-01-01T00:00:00.000Z'),
        ...(status === 'PAUSED' ? { status: 'PAUSED', pausedAt: new Date() } : {}),
      },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  taskTemplate: {
    async create({ tx, businessId }) {
      return (
        await tx.taskTemplate.create({ data: { businessId, name: `Fake template ${tag()}` } })
      ).id;
    },
  },
  complianceDeadline: { clientPrivate: true, create: (ctx) => makeDeadline(ctx) },
  /** A second deadline of client X, to relate. */
  complianceDeadlineLinked: { clientPrivate: true, create: (ctx) => makeDeadline(ctx) },
  complianceDeadlineClosed: {
    clientPrivate: true,
    create: (ctx) => makeDeadline(ctx, { status: 'COMPLETED' }),
  },
  /** A task of `complianceDeadline`. */
  complianceTask: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.task.create({
        data: {
          businessId,
          clientId: await get('client'),
          title: 'Fake deadline task',
          deadlineId: await get('complianceDeadline'),
        },
      });
      return row.id;
    },
  },
  /** A document of client X attached to `complianceDeadline`: the record is the document. */
  complianceAttachment: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const key = randomUUID();
      const doc = await tx.document.create({
        data: {
          businessId,
          clientId: await get('client'),
          engagementId: await get('engagement'),
          direction: 'FIRM_TO_CLIENT',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(key).digest('hex'),
          s3Key: `tenant/${businessId}/iso/${key}/fake.pdf`,
        },
      });
      await tx.complianceDeadlineDocument.create({
        data: { businessId, deadlineId: await get('complianceDeadline'), documentId: doc.id },
      });
      return doc.id;
    },
  },
  /** A deadline of client X related to `complianceDeadline`: the record is the related deadline. */
  complianceLinkedDeadline: {
    clientPrivate: true,
    async create(ctx) {
      const id = await makeDeadline(ctx);
      await ctx.tx.complianceDeadlineLink.create({
        data: {
          businessId: ctx.businessId,
          deadlineId: await ctx.get('complianceDeadline'),
          relatedDeadlineId: id,
        },
      });
      return id;
    },
  },
  complianceCalendar: calendar('DRAFT'),
  complianceCalendarOther: calendar('DRAFT'),
  complianceCalendarVerified: calendar('VERIFIED'),
  complianceCalendarSuperseded: calendar('SUPERSEDED'),
  /** The entry of `complianceCalendar`. */
  complianceCalendarEntry: {
    async create({ tx, businessId, get }) {
      const entry = await tx.complianceCalendarEntry.findFirstOrThrow({
        where: { businessId, calendarId: await get('complianceCalendar') },
      });
      return entry.id;
    },
  },
  complianceRecurrence: recurrence('ACTIVE'),
  complianceRecurrencePaused: recurrence('PAUSED'),
  /** A rule for `complianceCalendarEntry`; it suggests for every client. */
  complianceRule: {
    async create({ tx, businessId, get }) {
      const row = await tx.complianceApplicabilityRule.create({
        data: {
          businessId,
          name: `Fake rule ${tag()}`,
          calendarEntryId: await get('complianceCalendarEntry'),
        },
      });
      return row.id;
    },
  },
  /** What the rule suggested for client X. */
  complianceSuggestion: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.complianceApplicabilityRecord.create({
        data: {
          businessId,
          clientId: await get('client'),
          ruleId: await get('complianceRule'),
          ruleVersion: 1,
          dueOn: new Date('2030-04-15T00:00:00.000Z'),
          decision: 'SUGGESTED',
          reason: 'Fake rule applies',
        },
      });
      return row.id;
    },
  },
};

const D = `${BASE}/deadlines`;
const deadline = { id: 'complianceDeadline' };

export const cases: CaseModule['cases'] = {
  // ---------- Deadlines ----------
  'GET /api/v1/business/clients/:id/compliance': { params: { id: 'client' } },
  [`POST ${D}`]: {
    params: {},
    bodyIds: {
      clientId: 'client',
      engagementId: 'engagement',
      assignedUserId: 'adminUser',
      taskTemplateId: 'taskTemplate',
    },
    body: { name: 'Fake new deadline', type: 'TAX_FILING', dueOn: '2030-02-15', createTask: true },
  },
  [`POST ${D}/bulk`]: {
    params: {},
    bodyIds: { ids: 'complianceDeadline', assignedUserId: 'adminUser' },
    body: { action: 'REASSIGN' },
  },
  [`GET ${D}/:id`]: { params: deadline },
  [`PATCH ${D}/:id`]: {
    params: deadline,
    bodyIds: { engagementId: 'engagement', assignedUserId: 'adminUser' },
    body: { name: 'Fake renamed deadline' },
  },
  [`POST ${D}/:id/in-progress`]: { params: deadline },
  [`POST ${D}/:id/waiting-on-client`]: { params: deadline },
  [`POST ${D}/:id/complete`]: { params: deadline },
  [`POST ${D}/:id/reopen`]: { params: { id: 'complianceDeadlineClosed' } },
  [`POST ${D}/:id/not-applicable`]: { params: deadline, body: { reason: 'Fake reason' } },
  [`POST ${D}/:id/reassign`]: { params: deadline, bodyIds: { assignedUserId: 'adminUser' } },
  [`POST ${D}/:id/archive`]: { params: deadline },
  [`POST ${D}/:id/extension`]: {
    params: deadline,
    body: { filedOn: '2030-01-10', extendedDueOn: '2030-07-15' },
  },
  [`PUT ${D}/:id/reminders`]: { params: deadline, body: { reminders: [{ daysBefore: 3 }] } },
  [`POST ${D}/:id/tasks`]: { params: deadline, bodyIds: { templateId: 'taskTemplate' } },
  [`POST ${D}/:id/tasks/link`]: { params: deadline, bodyIds: { taskId: 'task' } },
  [`DELETE ${D}/:id/tasks/:taskId`]: {
    params: { ...deadline, taskId: 'complianceTask' },
  },
  [`POST ${D}/:id/documents`]: { params: deadline, bodyIds: { documentId: 'document' } },
  [`DELETE ${D}/:id/documents/:documentId`]: {
    params: { ...deadline, documentId: 'complianceAttachment' },
  },
  [`POST ${D}/:id/links`]: {
    params: deadline,
    bodyIds: { relatedDeadlineId: 'complianceDeadlineLinked' },
  },
  [`DELETE ${D}/:id/links/:relatedId`]: {
    params: { ...deadline, relatedId: 'complianceLinkedDeadline' },
  },
  [`POST ${D}/:id/save-as-template`]: { params: deadline, body: { name: 'Fake template' } },

  // ---------- Calendar library ----------
  [`GET ${BASE}/calendars/:id`]: { params: { id: 'complianceCalendar' } },
  [`PATCH ${BASE}/calendars/:id`]: {
    params: { id: 'complianceCalendar' },
    body: { name: 'Fake renamed calendar' },
  },
  [`GET ${BASE}/calendars/:id/compare/:otherId`]: {
    params: { id: 'complianceCalendar', otherId: 'complianceCalendarOther' },
  },
  [`POST ${BASE}/calendars/:id/verify`]: { params: { id: 'complianceCalendar' } },
  [`POST ${BASE}/calendars/:id/publish`]: { params: { id: 'complianceCalendarVerified' } },
  [`POST ${BASE}/calendars/:id/rollback`]: { params: { id: 'complianceCalendarSuperseded' } },
  [`POST ${BASE}/calendars/:id/archive`]: { params: { id: 'complianceCalendar' } },
  [`POST ${BASE}/calendars/:id/entries`]: {
    params: { id: 'complianceCalendar' },
    body: {
      ruleKind: 'FIXED_DATE',
      name: 'Fake new entry',
      type: 'TAX_FILING',
      dueOn: '2030-05-15',
    },
  },
  [`PATCH ${BASE}/calendars/:id/entries/:entryId`]: {
    params: { id: 'complianceCalendar', entryId: 'complianceCalendarEntry' },
    body: { name: 'Fake renamed entry' },
  },
  [`DELETE ${BASE}/calendars/:id/entries/:entryId`]: {
    params: { id: 'complianceCalendar', entryId: 'complianceCalendarEntry' },
  },

  // ---------- Recurring definitions ----------
  [`POST ${BASE}/recurrences`]: {
    params: {},
    bodyIds: {
      calendarEntryId: 'complianceCalendarEntry',
      taskTemplateId: 'taskTemplate',
      assignedUserId: 'adminUser',
    },
    body: {
      name: 'Fake new recurrence',
      type: 'PAYROLL',
      frequency: 'MONTHLY',
      repeatRule: { dayOfMonth: 5 },
      startOn: '2030-01-01',
      createTask: true,
    },
  },
  [`POST ${BASE}/recurrences/preview`]: {
    params: {},
    bodyIds: { calendarEntryId: 'complianceCalendarEntry' },
    body: { frequency: 'AUTHORITY_DEFINED' },
  },
  [`GET ${BASE}/recurrences/:id`]: { params: { id: 'complianceRecurrence' } },
  [`PATCH ${BASE}/recurrences/:id`]: {
    params: { id: 'complianceRecurrence' },
    bodyIds: {
      calendarEntryId: 'complianceCalendarEntry',
      taskTemplateId: 'taskTemplate',
      assignedUserId: 'adminUser',
    },
    body: { name: 'Fake renamed recurrence', createTask: true },
  },
  [`POST ${BASE}/recurrences/:id/pause`]: { params: { id: 'complianceRecurrence' } },
  [`POST ${BASE}/recurrences/:id/resume`]: { params: { id: 'complianceRecurrencePaused' } },
  [`POST ${BASE}/recurrences/:id/end`]: { params: { id: 'complianceRecurrence' } },
  [`POST ${BASE}/recurrences/:id/archive`]: { params: { id: 'complianceRecurrence' } },

  // ---------- Applicability rules and suggestions ----------
  [`POST ${BASE}/applicability-rules`]: {
    params: {},
    bodyIds: { 'target.id': 'complianceCalendarEntry' },
    body: { name: 'Fake new rule', target: { kind: 'CALENDAR_ENTRY', id: 'placeholder' } },
  },
  [`GET ${BASE}/applicability-rules/:id`]: { params: { id: 'complianceRule' } },
  [`PATCH ${BASE}/applicability-rules/:id`]: {
    params: { id: 'complianceRule' },
    body: { name: 'Fake renamed rule' },
  },
  [`POST ${BASE}/applicability-rules/:id/evaluate`]: { params: { id: 'complianceRule' } },
  [`POST ${BASE}/suggestions`]: { params: {}, bodyIds: { ruleId: 'complianceRule' } },
  [`POST ${BASE}/suggestions/:id/confirm`]: {
    params: { id: 'complianceSuggestion' },
    bodyIds: { assignedUserId: 'adminUser' },
  },
  [`POST ${BASE}/suggestions/:id/dismiss`]: {
    params: { id: 'complianceSuggestion' },
    body: { reason: 'Fake reason' },
  },

  // ---------- Settings ----------
  [`PATCH ${BASE}/settings`]: {
    params: {},
    bodyIds: { 'taskTemplates.taskTemplateId': 'taskTemplate' },
    body: { taskTemplates: [{ type: 'TAX_FILING', taskTemplateId: 'placeholder' }] },
  },
};
