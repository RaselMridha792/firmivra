// Synthetic QA fixtures for Octavia's Oct 28 reviews (R1; Rasel's card "Approve seed", Oct 29
// 14:13:47Z). Rows only, synthetic only, for LVP and Test Firm B: Compliance calendars of every
// family with a published and a draft version and their deadlines (CD-Y04, Y05, Y08, Y17),
// automation runs in every state (AU-Y18, Y19), audience segments and campaigns (CM-Y03, Y05,
// Y23), report schedules and runs (RP-Y06, Y07), and integration connections with syncs and a
// mapping (IN-Y02, Y13 to Y17). Every row has a fixed id and is created once: a re-run adds
// nothing and never updates or deletes a row, so rows Octavia made (her QA templates and
// categories, her SAL QA report definitions, the CD-F01 evidence tasks, the three client
// profiles, the IRS calendar) are never touched.
//
// Nothing can be sent from these rows:
// - automation rules are PAUSED (the engine only scans ACTIVE ones) and a pending action waits
//   until 2099 in a dry run;
// - no campaign is SENDING or has a QUEUED recipient (the delivery job resumes those), and the
//   scheduled one waits until 2099; clients use @example.test addresses and give no consent;
// - the active report schedule's next run is in 2099, and every recipient is the fixture member;
// - integration connections have no secret and no next sync (syncs run only on Sync Now);
// - fixture deadlines have no reminders.
// The actor is a synthetic user with no Cognito login and a DEACTIVATED membership: it holds no
// seat, signs nothing in and is never mailed. Ids are RFC 9562 UUIDs (version 4, variant 8).
import type { Prisma } from '../src/generated/prisma/client.js';
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

/** The two firms, by slug, and the digit that keeps each firm's fixed ids apart. */
export const QA_FIRMS = [
  { slug: 'lvp', digit: 0 },
  { slug: 'test-firm-b', digit: 1 },
] as const;

/** Fixed ids: 00000000-0000-4a28-800<firm>-<n>. */
export const qaId = (firm: number, n: number) =>
  `00000000-0000-4a28-800${firm}-${String(n).padStart(12, '0')}`;

/** The fixture member's user (one for both firms). */
export const QA_USER = {
  id: '00000000-0000-4a28-8009-000000000001',
  cognitoSub: 'qa-fixture-00000000-0000-4a28-8009-000000000001',
  email: 'qa-fixture@example.test',
  name: 'QA Fixture (synthetic)',
};

/** Far enough ahead that no job reaches it during the reviews. */
const NEVER = new Date('2099-01-04T14:00:00Z');
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const FAMILIES = [
  ['IRS_GENERAL', 'FEDERAL', null, 'TAX_FILING', 'Form 1120-S'],
  ['IRS_EMPLOYER', 'FEDERAL', null, 'PAYROLL', 'Form 941'],
  ['STATE_INCOME_FRANCHISE', 'STATE', 'GA', 'STATE_FILING', 'Form 600S'],
  ['SECRETARY_OF_STATE', 'STATE', 'GA', 'ANNUAL_REPORT', 'Annual Registration'],
  ['SALES_USE_TAX', 'STATE', 'GA', 'SALES_TAX', 'Form ST-3'],
  ['PAYROLL_WITHHOLDING', 'STATE', 'GA', 'PAYROLL', 'Form G-7'],
  ['LOCAL_BUSINESS_LICENSE', 'LOCAL', 'GA', 'LICENSE_PERMIT', 'Business License Renewal'],
  ['PROFESSIONAL_LICENSE', 'STATE', 'GA', 'LICENSE_PERMIT', 'CPA License Renewal'],
  ['FIRM_INTERNAL', 'INTERNAL', null, 'OTHER', 'Engagement Letter Review'],
] as const;

export interface QaSeedResult {
  seeded: string[];
  missing: string[];
}

/** Seeds every firm of QA_FIRMS that exists; a missing firm is reported, never created. */
export async function seedQa(owner: PrismaClient): Promise<QaSeedResult> {
  const result: QaSeedResult = { seeded: [], missing: [] };
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    if (!(await tx.user.findUnique({ where: { id: QA_USER.id } }))) {
      await tx.user.create({ data: { ...QA_USER, pool: 'STAFF' } });
    }
  });
  for (const firm of QA_FIRMS) {
    const business = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.findUnique({ where: { slug: firm.slug }, select: { id: true } }),
    );
    if (!business) {
      result.missing.push(firm.slug);
      continue;
    }
    await runInScope(owner, { kind: 'business', businessId: business.id }, (tx) =>
      seedFirm(tx, business.id, firm.digit),
    );
    result.seeded.push(firm.slug);
  }
  return result;
}

async function seedFirm(tx: TxClient, businessId: string, f: number) {
  const id = (n: number) => qaId(f, n);
  // Already seeded: the firm's marker row (its fixture membership) exists.
  if (await tx.membership.findUnique({ where: { id: id(1) } })) return;
  const userId = QA_USER.id;
  await tx.membership.create({
    data: { id: id(1), businessId, userId, role: 'STAFF', status: 'DEACTIVATED' },
  });
  const clients = [id(2), id(3), id(4)];
  for (const [i, clientId] of clients.entries()) {
    await tx.client.create({
      data: {
        id: clientId,
        businessId,
        displayName: `QA Fixture Client ${i + 1}`,
        email: `qa-fixture-${i + 1}@example.test`,
      },
    });
  }
  await seedCompliance(tx, businessId, id, clients[0]!);
  await seedAutomations(tx, businessId, id, clients[0]!);
  await seedCommunications(tx, businessId, id, clients);
  await seedReports(tx, businessId, id);
  await seedIntegrations(tx, businessId, id);
}

type Ids = (n: number) => string;

/** One published calendar per family with an entry and a client deadline; IRS General also has a
 *  second, draft version; its deadline carries the extension and payment dates (CD-Y04), and a
 *  second, completed deadline carries the filing evidence (CD-Y17). No reminders. */
async function seedCompliance(tx: TxClient, businessId: string, id: Ids, clientId: string) {
  for (const [i, [family, jurisdiction, state, type, form]] of FAMILIES.entries()) {
    const calendarId = id(100 + i);
    const entryId = id(120 + i);
    await tx.complianceCalendar.create({
      data: {
        id: calendarId,
        businessId,
        family,
        authority: `QA Fixture ${family.replaceAll('_', ' ').toLowerCase()}`,
        jurisdiction,
        state,
        effectiveYear: 2027,
        name: `QA Fixture ${form} calendar 2027`,
        sourceUrl: 'https://www.irs.gov/publications/p509',
        retrievedAt: new Date('2026-10-28T12:00:00Z'),
        createdByUserId: QA_USER.id,
      },
    });
    const dueOn = day(`2027-0${(i % 9) + 1}-15`);
    await tx.complianceCalendarEntry.create({
      data: {
        id: entryId,
        businessId,
        calendarId,
        name: `QA Fixture ${form}`,
        type,
        form,
        ruleKind: 'FIXED_DATE',
        dueOn,
      },
    });
    // Entries are added while the calendar is a draft; then it is verified and published.
    await tx.complianceCalendar.update({
      where: { id: calendarId },
      data: { status: 'VERIFIED', verifiedAt: new Date('2026-10-28T12:00:00Z') },
    });
    await tx.complianceCalendar.update({
      where: { id: calendarId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-28T12:30:00Z'),
        publishedByUserId: QA_USER.id,
      },
    });
    const irs = family === 'IRS_GENERAL';
    await tx.complianceDeadline.create({
      data: {
        id: id(140 + i),
        businessId,
        clientId,
        name: `QA Fixture ${form} 2027`,
        type,
        source: 'GOVERNMENT',
        relatedForm: form,
        jurisdiction,
        state,
        taxYear: 2026,
        statutoryDueOn: dueOn,
        dueOn: irs ? day('2027-09-15') : dueOn,
        // CD-Y04: an extension moves the filing date, never the payment date.
        ...(irs && {
          extensionFiledOn: day('2027-03-10'),
          extendedDueOn: day('2027-09-15'),
          paymentDueOn: dueOn,
        }),
        calendarEntryId: entryId,
        applicabilityReason: 'QA fixture: applies to every synthetic client',
        createdByUserId: QA_USER.id,
      },
    });
  }
  // CD-Y05: a second, draft version of the IRS General calendar, to compare with the published one.
  await tx.complianceCalendar.create({
    data: {
      id: id(160),
      businessId,
      family: 'IRS_GENERAL',
      authority: 'QA Fixture irs general',
      jurisdiction: 'FEDERAL',
      effectiveYear: 2027,
      version: 2,
      name: 'QA Fixture Form 1120-S calendar 2027 (draft)',
      sourceUrl: 'https://www.irs.gov/publications/p509',
      retrievedAt: new Date('2026-10-29T12:00:00Z'),
      createdByUserId: QA_USER.id,
    },
  });
  await tx.complianceCalendarEntry.create({
    data: {
      id: id(161),
      businessId,
      calendarId: id(160),
      name: 'QA Fixture Form 1120-S',
      type: 'TAX_FILING',
      form: 'Form 1120-S',
      ruleKind: 'FIXED_DATE',
      dueOn: day('2027-03-16'),
    },
  });
  // CD-Y17: a second, firm-owned deadline, completed with its filing evidence.
  await tx.complianceDeadline.create({
    data: {
      id: id(162),
      businessId,
      clientId,
      name: 'QA Fixture quarterly estimate (filed)',
      type: 'ESTIMATED_TAX',
      source: 'FIRM',
      taxYear: 2026,
      dueOn: day('2026-09-15'),
      paymentDueOn: day('2026-09-15'),
      status: 'COMPLETED',
      completedAt: new Date('2026-09-12T15:00:00Z'),
      completedByUserId: QA_USER.id,
      filedOn: day('2026-09-12'),
      confirmationNumber: 'QA-FIXTURE-0001',
      createdByUserId: QA_USER.id,
    },
  });
}

/** A paused rule (never scanned) with runs in every state, a dry run, and a chain (AU-Y18, Y19).
 *  Actions are internal (make a task, add a note): nothing here sends. */
async function seedAutomations(tx: TxClient, businessId: string, id: Ids, clientId: string) {
  const ruleId = id(200);
  const versionId = id(201);
  await tx.automationRule.create({
    data: {
      id: ruleId,
      businessId,
      name: 'QA Fixture: task before a deadline',
      category: 'COMPLIANCE_DEADLINES',
      ownerUserId: QA_USER.id,
      createdByUserId: QA_USER.id,
    },
  });
  await tx.automationRuleVersion.create({
    data: {
      id: versionId,
      businessId,
      ruleId,
      version: 1,
      triggerModule: 'COMPLIANCE_DEADLINES',
      triggerEvent: 'deadline.approaching',
      timing: 'BEFORE',
      offsetValue: 7,
      offsetUnit: 'DAY',
      actions: [
        { id: 'a1', type: 'create_task', config: { title: 'QA fixture task' }, delayMinutes: 0 },
        { id: 'a2', type: 'add_note', config: { text: 'QA fixture note' }, delayMinutes: 0 },
      ],
      createdByUserId: QA_USER.id,
    },
  });
  await tx.automationRule.update({
    where: { id: ruleId },
    data: { status: 'PAUSED', currentVersionId: versionId },
  });
  const recordId = id(140);
  const runs: [number, string, Record<string, unknown>][] = [
    [210, 'SUCCESS', {}],
    [211, 'PARTIAL_SUCCESS', { errorCode: 'NOTE_TARGET_MISSING', message: 'One action failed.' }],
    [212, 'FAILED', { errorCode: 'TASK_ASSIGNEE_INACTIVE', message: 'No action succeeded.' }],
    [213, 'SKIPPED', { errorCode: 'CONDITIONS_NOT_MET', message: 'Conditions did not match.' }],
    [214, 'SUCCESS', { dryRun: true }],
    [215, 'PENDING', { dryRun: true }],
    [216, 'SUCCESS', { parentRunId: id(210), depth: 1 }],
  ];
  for (const [n, status, extra] of runs) {
    const finished = status !== 'PENDING';
    await tx.automationRun.create({
      data: {
        id: id(n),
        businessId,
        ruleId,
        ruleVersionId: versionId,
        status: status as 'SUCCESS',
        sourceModule: 'COMPLIANCE_DEADLINES',
        sourceEventKey: `deadline.approaching:${recordId}:qa-${n}`,
        clientId,
        recordKind: 'deadline',
        recordId,
        correlationId: n === 216 ? id(210) : id(n),
        startedAt: new Date(`2026-10-2${n % 10}T09:00:00Z`),
        ...(finished && {
          finishedAt: new Date(`2026-10-2${n % 10}T09:00:05Z`),
          durationMs: 5000,
        }),
        ...extra,
      } as Prisma.AutomationRunUncheckedCreateInput,
    });
  }
  const executions: [number, number, string, string, Record<string, unknown>][] = [
    [220, 210, 'a1', 'SUCCESS', {}],
    [221, 210, 'a2', 'SUCCESS', {}],
    [222, 211, 'a1', 'SUCCESS', {}],
    [223, 211, 'a2', 'FAILED', { errorCode: 'NOTE_TARGET_MISSING', retryable: false }],
    [224, 212, 'a1', 'FAILED', { errorCode: 'TASK_ASSIGNEE_INACTIVE', retryable: true }],
    [225, 213, 'a1', 'SKIPPED', {}],
    [226, 214, 'a1', 'SUCCESS', {}],
    [227, 215, 'a1', 'PENDING', { scheduledFor: NEVER }],
    [228, 216, 'a1', 'SUCCESS', {}],
  ];
  for (const [n, run, actionKey, status, extra] of executions) {
    await tx.automationActionExecution.create({
      data: {
        id: id(n),
        businessId,
        runId: id(run),
        actionKey,
        position: actionKey === 'a1' ? 0 : 1,
        actionType: actionKey === 'a1' ? 'create_task' : 'add_note',
        status: status as 'SUCCESS',
        idempotencyKey: `${id(run)}:${actionKey}`,
        attempts: status === 'PENDING' ? 0 : 1,
        ...(status !== 'PENDING' && {
          startedAt: new Date('2026-10-20T09:00:01Z'),
          finishedAt: new Date('2026-10-20T09:00:03Z'),
        }),
        ...extra,
      } as Prisma.AutomationActionExecutionUncheckedCreateInput,
    });
  }
}

/** A static and a dynamic segment with known members, and a campaign in each state that can be
 *  held without sending (CM-Y03, Y05, Y23). Recipients are final; none is QUEUED. */
async function seedCommunications(tx: TxClient, businessId: string, id: Ids, clients: string[]) {
  await tx.communicationSegment.create({
    data: {
      id: id(300),
      businessId,
      name: 'QA Fixture static list',
      type: 'STATIC',
      ownerUserId: QA_USER.id,
      memberCount: clients.length,
      lastRefreshedAt: new Date('2026-10-28T12:00:00Z'),
    },
  });
  for (const [i, clientId] of clients.entries()) {
    await tx.communicationSegmentMember.create({
      data: { id: id(310 + i), businessId, segmentId: id(300), clientId },
    });
  }
  await tx.communicationSegment.create({
    data: {
      id: id(301),
      businessId,
      name: 'QA Fixture dynamic: active clients',
      type: 'DYNAMIC',
      ownerUserId: QA_USER.id,
      criteria: { all: [{ field: 'status', is: 'ACTIVE' }] },
      criteriaSummary: 'Status is Active',
      lastRefreshedAt: new Date('2026-10-28T12:00:00Z'),
    },
  });
  const campaign = (n: number, name: string, data: Record<string, unknown> = {}) =>
    tx.communication.create({
      data: {
        id: id(n),
        businessId,
        channel: 'EMAIL',
        name: `QA Fixture: ${name}`,
        subject: `QA fixture ${name}`,
        body: 'Synthetic QA fixture. Nothing is sent from this campaign.',
        fromName: 'QA Fixture',
        timezone: 'America/New_York',
        createdByUserId: QA_USER.id,
        ...data,
      },
    });
  const audience = (n: number) =>
    tx.communicationAudienceEntry.create({
      data: {
        businessId,
        communicationId: id(n),
        kind: 'SEGMENT',
        segmentId: id(300),
        segmentName: 'QA Fixture static list',
        criteriaSnapshot: {},
      },
    });
  const counts = { selectedCount: 3, autoExcludedCount: 0, manualExcludedCount: 0, finalCount: 3 };
  const set = (n: number, data: Record<string, unknown>) =>
    tx.communication.update({ where: { id: id(n) }, data });
  const recipients = async (n: number, statuses: string[]) => {
    for (const [i, status] of statuses.entries()) {
      await tx.communicationRecipient.create({
        data: {
          id: id(n * 10 + i),
          businessId,
          communicationId: id(n),
          clientId: clients[i]!,
          addressMask: `q***@example.test`,
          status: status as 'SENT',
          sentAt: new Date('2026-10-20T14:00:00Z'),
          ...(status === 'FAILED' && { failureCode: 'mailbox_unavailable' }),
          ...(status === 'BOUNCED' && { failureCode: 'hard_bounce' }),
          ...(status === 'OPENED' && {
            firstOpenedAt: new Date('2026-10-20T15:00:00Z'),
            openCount: 1,
          }),
        },
      });
    }
  };

  await campaign(320, 'draft');
  await audience(320);

  await campaign(321, 'scheduled');
  await audience(321);
  await set(321, { status: 'SCHEDULED', scheduledFor: NEVER, ...counts });

  // Sent: went out on Oct 20 (rows only), with an open and a bounce.
  await campaign(322, 'sent');
  await audience(322);
  await set(322, { status: 'SENDING', startedAt: new Date('2026-10-20T14:00:00Z'), ...counts });
  await recipients(322, ['DELIVERED', 'OPENED', 'BOUNCED']);
  await set(322, { status: 'SENT', sentAt: new Date('2026-10-20T14:05:00Z') });

  // Paused part-way: every recipient already final, so a resume has nobody left to send to.
  await campaign(323, 'paused');
  await audience(323);
  await set(323, { status: 'SENDING', startedAt: new Date('2026-10-21T14:00:00Z'), ...counts });
  await recipients(323, ['SENT', 'FAILED']);
  await set(323, { status: 'PAUSED' });

  // Failed: every recipient failed (CM-Y23's failed-recipient data).
  await campaign(324, 'failed');
  await audience(324);
  await set(324, { status: 'SENDING', startedAt: new Date('2026-10-22T14:00:00Z'), ...counts });
  await recipients(324, ['FAILED', 'FAILED', 'FAILED']);
  await set(324, { status: 'FAILED' });

  await campaign(325, 'cancelled');
  await audience(325);
  await set(325, { status: 'SCHEDULED', scheduledFor: NEVER, ...counts });
  await set(325, { status: 'CANCELLED', cancelledAt: new Date('2026-10-23T14:00:00Z') });
}

/** A report with an active schedule (next run in 2099), a paused one and one whose last run
 *  failed, with their run history (RP-Y06, Y07). Recipients are the fixture member only. */
async function seedReports(tx: TxClient, businessId: string, id: Ids) {
  await tx.reportDefinition.create({
    data: {
      id: id(400),
      businessId,
      category: 'FINANCIAL',
      dataSource: 'invoices_payments',
      name: 'QA Fixture revenue report',
      columns: ['client_name', 'invoice_number', 'invoice_date', 'amount', 'balance_due'],
      datePreset: 'this_year',
      ownerUserId: QA_USER.id,
      visibility: 'COMPANY',
    },
  });
  const schedules: [number, string, Record<string, unknown>][] = [
    [410, 'active', { nextRunAt: NEVER, lastStatus: 'SUCCEEDED' }],
    [411, 'paused', { active: false, nextRunAt: null }],
    [412, 'failed last run', { nextRunAt: NEVER, lastStatus: 'FAILED' }],
  ];
  for (const [n, label, extra] of schedules) {
    await tx.reportSchedule.create({
      data: {
        id: id(n),
        businessId,
        definitionId: id(400),
        name: `QA Fixture schedule (${label})`,
        frequency: 'WEEKLY',
        weekday: 1,
        runTime: new Date('1970-01-01T08:00:00Z'),
        timezone: 'America/New_York',
        datePreset: 'previous_week',
        formats: ['CSV'],
        ownerUserId: QA_USER.id,
        lastRunAt: new Date('2026-10-26T12:00:00Z'),
        ...extra,
      } as Prisma.ReportScheduleUncheckedCreateInput,
    });
    await tx.reportScheduleRecipient.create({
      data: { id: id(n + 10), businessId, scheduleId: id(n), userId: QA_USER.id },
    });
  }
  const runs: [number, number, string][] = [
    [430, 410, 'SUCCEEDED'],
    [431, 410, 'SUCCEEDED'],
    [432, 412, 'FAILED'],
  ];
  for (const [n, schedule, status] of runs) {
    await tx.reportRun.create({
      data: {
        id: id(n),
        businessId,
        definitionId: id(400),
        scheduleId: id(schedule),
        kind: 'SCHEDULED',
        status: status as 'SUCCEEDED',
        format: 'CSV',
        rowCount: status === 'FAILED' ? null : 4,
        errorCode: status === 'FAILED' ? 'query_timeout' : null,
        startedAt: new Date('2026-10-26T12:00:00Z'),
        finishedAt: new Date('2026-10-26T12:00:03Z'),
      },
    });
  }
}

/** Connections in each state, with successful and failed syncs and a field mapping (IN-Y02,
 *  Y13 to Y17). No secret and no next sync: a sync runs only when someone presses Sync Now. */
async function seedIntegrations(tx: TxClient, businessId: string, id: Ids) {
  const connections: [number, string, string, Record<string, unknown>][] = [
    [500, 'xero', 'CONNECTED', { lastSyncAt: new Date('2026-10-28T10:00:00Z') }],
    [501, 'gusto', 'CONNECTED', { lastSyncAt: new Date('2026-10-28T10:05:00Z') }],
    [502, 'hubspot', 'NEEDS_ATTENTION', { statusReason: 'auth_expired' }],
    [503, 'mailchimp', 'DISCONNECTED', { disconnectedAt: new Date('2026-10-27T16:00:00Z') }],
  ];
  for (const [n, provider, status, extra] of connections) {
    await tx.integrationConnection.create({
      data: {
        id: id(n),
        businessId,
        provider,
        environment: 'TEST',
        status: status as 'CONNECTED',
        accountLabel: `QA Fixture ${provider} account`,
        entities: ['customers', 'invoices'],
        syncEveryMinutes: 60,
        connectedByUserId: QA_USER.id,
        ...extra,
      } as Prisma.IntegrationConnectionUncheckedCreateInput,
    });
  }
  await tx.integrationFieldMapping.create({
    data: {
      id: id(510),
      businessId,
      connectionId: id(500),
      scope: 'client',
      localField: 'client.name',
      externalField: 'Contact Name',
    },
  });
  const syncs: [number, number, string, Record<string, unknown>][] = [
    [520, 500, 'SUCCEEDED', { recordCount: 12 }],
    [521, 501, 'PARTIAL', { recordCount: 9, failedCount: 1 }],
    [522, 502, 'FAILED', { errorCode: 'auth_expired' }],
  ];
  for (const [n, connectionId, status, extra] of syncs) {
    await tx.integrationSyncRun.create({
      data: {
        id: id(n),
        businessId,
        connectionId: id(connectionId),
        entity: 'customers',
        status: status as 'SUCCEEDED',
        startedAt: new Date('2026-10-28T10:00:00Z'),
        finishedAt: new Date('2026-10-28T10:00:20Z'),
        ...extra,
      } as Prisma.IntegrationSyncRunUncheckedCreateInput,
    });
  }
}
