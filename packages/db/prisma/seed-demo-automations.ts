// Demo seed, stage 5 (R0, Oct 19): Automations for the demo firm. Five rules across the modules
// (four active with their first version, one paused, one draft, one archived), a run history with
// successes, a partial success, a failure and a skipped duplicate, each run's action executions,
// three saved workflow templates, and the firm's automation settings. Patterned on LVP's
// automation seed (seed-r38.ts). Synthetic data; fixed ids, created once.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const id = (key: string) => demoId(`automation:${key}`);

type Module =
  | 'COMPLIANCE_DEADLINES'
  | 'LEADS'
  | 'INVOICES_PAYMENTS'
  | 'DOCUMENTS'
  | 'APPOINTMENTS'
  | 'TAX_RETURNS';

interface DemoRule {
  key: string;
  name: string;
  description: string;
  module: Module;
  event: string;
  timing: 'IMMEDIATE' | 'BEFORE' | 'AFTER';
  offset?: [number, 'DAY' | 'HOUR'];
  conditions: { field: string; operator: string; value: string | number | boolean }[];
  actions: { id: string; type: string; config: Record<string, string>; delayMinutes?: number }[];
  status: 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ARCHIVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  owner: DemoStaffKey;
  recordKind?: string;
}

const RULES: readonly DemoRule[] = [
  {
    key: 'estimate-reminder',
    name: 'Estimated tax reminder, 14 days before',
    description: 'Emails the client and opens a task two weeks before each estimated payment.',
    module: 'COMPLIANCE_DEADLINES',
    event: 'deadline.approaching',
    timing: 'BEFORE',
    offset: [14, 'DAY'],
    conditions: [{ field: 'deadline.type', operator: 'is', value: 'ESTIMATED_TAX' }],
    actions: [
      { id: 'a1', type: 'create_task', config: { title: 'Confirm the estimated payment' } },
      {
        id: 'a2',
        type: 'send_email',
        config: { template: 'Estimated Tax Reminder' },
        delayMinutes: 0,
      },
    ],
    status: 'ACTIVE',
    priority: 'HIGH',
    owner: 'taxPreparer',
    recordKind: 'deadline',
  },
  {
    key: 'new-lead',
    name: 'New Begin Online lead: assign and welcome',
    description: 'Assigns new leads to client support and sends the welcome email.',
    module: 'LEADS',
    event: 'lead.submitted',
    timing: 'IMMEDIATE',
    conditions: [],
    actions: [
      { id: 'a1', type: 'assign_owner', config: { userRole: 'clientSupport' } },
      { id: 'a2', type: 'send_email', config: { template: 'Welcome to the firm' } },
    ],
    status: 'ACTIVE',
    priority: 'HIGH',
    owner: 'clientSupport',
    recordKind: 'lead',
  },
  {
    key: 'invoice-overdue',
    name: 'Overdue invoice reminder, 3 days after due',
    description: 'Sends a friendly reminder when an invoice is three days past due.',
    module: 'INVOICES_PAYMENTS',
    event: 'invoice.overdue',
    timing: 'AFTER',
    offset: [3, 'DAY'],
    conditions: [{ field: 'invoice.balance_due_cents', operator: 'greater_than', value: 0 }],
    actions: [{ id: 'a1', type: 'send_email', config: { template: 'Friendly invoice reminder' } }],
    status: 'ACTIVE',
    priority: 'MEDIUM',
    owner: 'admin',
    recordKind: 'invoice',
  },
  {
    key: 'document-uploaded',
    name: 'Tell the preparer when a client uploads',
    description: 'Notifies the engagement owner when a client uploads a document.',
    module: 'DOCUMENTS',
    event: 'document.uploaded',
    timing: 'IMMEDIATE',
    conditions: [{ field: 'document.source', operator: 'is', value: 'CLIENT' }],
    actions: [{ id: 'a1', type: 'notify_user', config: { to: 'engagement_owner' } }],
    status: 'ACTIVE',
    priority: 'MEDIUM',
    owner: 'manager',
    recordKind: 'document',
  },
  {
    key: 'appointment-reminder',
    name: 'Appointment reminder text, 1 day before',
    description: 'Texts the client a day before a booked appointment.',
    module: 'APPOINTMENTS',
    event: 'appointment.upcoming',
    timing: 'BEFORE',
    offset: [24, 'HOUR'],
    conditions: [{ field: 'client.sms_opt_in', operator: 'is', value: true }],
    actions: [{ id: 'a1', type: 'send_sms', config: { template: 'Appointment reminder (text)' } }],
    status: 'PAUSED',
    priority: 'LOW',
    owner: 'clientSupport',
  },
  {
    key: 'return-accepted',
    name: 'Return accepted: thank-you and review request',
    description: 'Draft: thanks the client and asks for a review once the IRS accepts the return.',
    module: 'TAX_RETURNS',
    event: 'tax_return.accepted',
    timing: 'IMMEDIATE',
    conditions: [],
    actions: [{ id: 'a1', type: 'send_email', config: { template: 'Return filed' } }],
    status: 'DRAFT',
    priority: 'LOW',
    owner: 'manager',
  },
  {
    key: 'old-organizer',
    name: 'Organizer reminder (last season)',
    description: 'Replaced by the intake form reminders.',
    module: 'TAX_RETURNS',
    event: 'tax_return.created',
    timing: 'AFTER',
    offset: [7, 'DAY'],
    conditions: [],
    actions: [{ id: 'a1', type: 'send_email', config: { template: 'Tax organizer ready' } }],
    status: 'ARCHIVED',
    priority: 'LOW',
    owner: 'taxPreparer',
  },
];

export async function seedDemoAutomations(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.automationSettings.upsert({
      where: { businessId },
      update: {},
      create: { businessId, failureAlertUserIds: [user('owner'), user('admin')] },
    });
    for (const r of RULES) await seedRule(tx, org, r);
    for (const r of RULES.slice(0, 3)) {
      await tx.automationTemplate.upsert({
        where: { id: id(`template:${r.key}`) },
        update: {},
        create: {
          id: id(`template:${r.key}`),
          businessId,
          name: r.name.replace(/,.*$/, '') + ' workflow',
          description: r.description,
          category: r.module,
          definition: {
            trigger: {
              module: r.module,
              event: r.event,
              timing: r.timing,
              ...(r.offset ? { offsetValue: r.offset[0], offsetUnit: r.offset[1] } : {}),
            },
            matchMode: 'ALL',
            conditions: r.conditions,
            actions: r.actions,
            settings: { preventDuplicatesDays: 7, logAll: true, notifyOnFailure: true },
          },
          createdByUserId: user(r.owner),
        },
      });
    }
  });
}

/** A rule, its first version, and for active rules a run history with action executions. */
async function seedRule(tx: TxClient, org: DemoOrgResult, r: DemoRule) {
  const { businessId } = org;
  const ruleId = id(`rule:${r.key}`);
  if (await tx.automationRule.findUnique({ where: { id: ruleId } })) return;
  await tx.automationRule.create({
    data: {
      id: ruleId,
      businessId,
      name: r.name,
      description: r.description,
      category: r.module,
      priority: r.priority,
      ownerUserId: user(r.owner),
      createdByUserId: user(r.owner),
    },
  });
  const versionId = id(`rule:${r.key}:v1`);
  await tx.automationRuleVersion.create({
    data: {
      id: versionId,
      businessId,
      ruleId,
      version: 1,
      triggerModule: r.module,
      triggerEvent: r.event,
      timing: r.timing,
      ...(r.offset ? { offsetValue: r.offset[0], offsetUnit: r.offset[1] } : {}),
      conditions: r.conditions,
      actions: r.actions,
      settings: { preventDuplicatesDays: 7, logAll: true, notifyOnFailure: true },
      createdByUserId: user(r.owner),
    },
  });
  if (r.status !== 'DRAFT') {
    await tx.automationRule.update({
      where: { id: ruleId },
      data: {
        status: r.status,
        currentVersionId: versionId,
        ...(r.status === 'ARCHIVED' ? { archivedAt: demoDay(-120) } : {}),
      },
    });
  }
  if (r.status !== 'ACTIVE' || !r.recordKind) return;

  // Runs over the last two weeks: mostly successes; the second rule has one action fail, the
  // third a bounce, and the fourth skips a duplicate.
  const clientIds = Object.values(org.clients);
  const outcomes = ['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'SUCCESS'] as const;
  for (let k = 0; k < 5; k++) {
    const runId = id(`rule:${r.key}:run:${k}`);
    const started = new Date(demoDay(-2 - k * 3).getTime() + 9 * 3_600_000);
    const outcome =
      r.key === 'new-lead' && k === 1
        ? 'PARTIAL_SUCCESS'
        : r.key === 'document-uploaded' && k === 2
          ? 'SKIPPED'
          : r.key === 'invoice-overdue'
            ? outcomes[k]!
            : 'SUCCESS';
    const failed = outcome === 'FAILED' || outcome === 'PARTIAL_SUCCESS';
    await tx.automationRun.create({
      data: {
        id: runId,
        businessId,
        ruleId,
        ruleVersionId: versionId,
        sourceModule: r.module,
        sourceEventKey: `${r.event}:demo-${k}`,
        clientId: clientIds[(k * 5 + r.key.length) % clientIds.length]!,
        recordKind: r.recordKind,
        recordId: demoId(`automation:record:${r.key}:${k}`),
        correlationId: runId,
        status: outcome,
        ...(outcome === 'SKIPPED'
          ? {
              errorCode: 'DUPLICATE_WITHIN_WINDOW',
              message: 'Ran for this document in the last 7 days.',
            }
          : { startedAt: started, durationMs: 2000 + k * 900 }),
        finishedAt: new Date(started.getTime() + 2000 + k * 900),
        ...(failed
          ? {
              errorCode: outcome === 'FAILED' ? 'EMAIL_UNDELIVERABLE' : 'ASSIGNEE_UNAVAILABLE',
              message:
                outcome === 'FAILED'
                  ? 'The client’s email address bounced.'
                  : 'The welcome email was sent; the assignee was out of office.',
            }
          : {}),
      },
    });
    if (outcome === 'SKIPPED') continue;
    await tx.automationRule.update({ where: { id: ruleId }, data: { lastRunAt: started } });
    for (const [position, action] of r.actions.entries()) {
      const actionFailed =
        (outcome === 'FAILED' && action.type.startsWith('send_')) ||
        (outcome === 'PARTIAL_SUCCESS' && position === 0);
      await tx.automationActionExecution.create({
        data: {
          id: id(`rule:${r.key}:run:${k}:${action.id}`),
          businessId,
          runId,
          actionKey: action.id,
          position,
          actionType: action.type,
          status: actionFailed ? 'FAILED' : 'SUCCESS',
          attempts: actionFailed ? 3 : 1,
          idempotencyKey: `${runId}:${action.id}`,
          startedAt: new Date(started.getTime() + 500 + position * 700),
          finishedAt: new Date(started.getTime() + 1100 + position * 700),
          ...(actionFailed
            ? {
                retryable: false,
                errorCode: outcome === 'FAILED' ? 'EMAIL_UNDELIVERABLE' : 'ASSIGNEE_UNAVAILABLE',
                detail:
                  outcome === 'FAILED' ? 'Mailbox does not exist' : 'Assignee is out of office',
              }
            : {}),
        },
      });
    }
  }
}
