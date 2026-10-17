// Payroll tracking (R39 Payroll API): payroll clients, workers, runs with their lines and issues,
// filings, reports, year-end and settings. Each world has its own PAYROLL service and records.
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef } from '../world.js';

const BASE = '/api/v1/business/payroll';

/** Each run needs its own period: a payroll client has one run per period. */
let period = 0;
const nextPeriod = () => {
  period += 1;
  const month = String((period % 12) + 1).padStart(2, '0');
  const year = 2030 + Math.floor(period / 12);
  return {
    periodStart: new Date(`${year}-${month}-01T00:00:00.000Z`),
    periodEnd: new Date(`${year}-${month}-15T00:00:00.000Z`),
    payDate: new Date(`${year}-${month}-19T00:00:00.000Z`),
  };
};

type RunState = 'IN_PROGRESS' | 'READY_FOR_REVIEW' | 'APPROVED' | 'SUBMITTED' | 'COMPLETED';

const run = (state: RunState): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, owner, get }) {
    const stamp = new Date('2030-01-01T00:00:00.000Z');
    const row = await tx.payrollRun.create({
      data: {
        businessId,
        payrollClientId: await get('payrollClient'),
        ...nextPeriod(),
        frequency: 'SEMI_MONTHLY',
        status: state,
        ...(state === 'IN_PROGRESS' ? {} : { readyAt: stamp }),
        ...(['APPROVED', 'SUBMITTED', 'COMPLETED'].includes(state)
          ? { approvedAt: stamp, approvedByUserId: owner.id }
          : {}),
        ...(['SUBMITTED', 'COMPLETED'].includes(state)
          ? { submittedAt: stamp, submittedByUserId: owner.id }
          : {}),
        ...(state === 'COMPLETED' ? { completedAt: stamp } : {}),
      },
    });
    if (state === 'IN_PROGRESS') {
      await tx.payrollRunLine.create({
        data: { businessId, runId: row.id, workerId: await get('payrollWorker') },
      });
    }
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  /** The firm's Payroll service. */
  payrollService: {
    async create({ tx, businessId }) {
      return (
        await tx.service.create({
          data: { businessId, kind: 'PAYROLL', name: `Fake payroll ${randomUUID().slice(0, 8)}` },
        })
      ).id;
    },
  },
  /** Client X is a payroll client (a Gusto client, not connected). */
  payrollClient: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const clientId = await get('client');
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId,
          serviceId: await get('payrollService'),
          title: 'Fake payroll',
        },
      });
      const row = await tx.payrollClient.create({
        data: {
          businessId,
          clientId,
          engagementId: engagement.id,
          status: 'ON_TRACK',
          frequency: 'BIWEEKLY',
          providerKey: 'gusto',
        },
      });
      return row.id;
    },
  },
  /** A client with no payroll yet, for adding. */
  payrollNewClient: {
    async create({ tx, businessId }) {
      return (
        await tx.client.create({
          data: { businessId, displayName: `Fake new payroll client ${randomUUID().slice(0, 8)}` },
        })
      ).id;
    },
  },
  payrollWorker: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.payrollWorker.create({
        data: {
          businessId,
          payrollClientId: await get('payrollClient'),
          displayName: 'Fake Worker',
          workerType: 'FULL_TIME',
          payType: 'HOURLY',
          rateCents: 1_800,
        },
      });
      return row.id;
    },
  },
  payrollRun: run('IN_PROGRESS'),
  payrollRunReady: run('READY_FOR_REVIEW'),
  payrollRunApproved: run('APPROVED'),
  payrollRunSubmitted: run('SUBMITTED'),
  payrollRunReopen: run('READY_FOR_REVIEW'),
  payrollRunIssue: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.payrollRunIssue.create({
        data: {
          businessId,
          runId: await get('payrollRun'),
          severity: 'WARNING',
          code: 'overtime_review',
          message: 'Fake issue.',
        },
      });
      return row.id;
    },
  },
};

const lines = { lines: [{ workerId: randomUUID(), hours: 10, regularPayCents: 18_000 }] };

export const cases: CaseModule['cases'] = {
  // ---------- Payroll clients ----------
  [`POST ${BASE}/clients`]: {
    params: {},
    bodyIds: { clientId: 'payrollNewClient', assignedUserId: 'adminUser' },
    body: { frequency: 'WEEKLY' },
  },
  [`GET ${BASE}/clients/:id`]: { params: { id: 'payrollClient' } },
  [`PATCH ${BASE}/clients/:id`]: {
    params: { id: 'payrollClient' },
    bodyIds: { assignedUserId: 'adminUser' },
    body: { industry: 'Fake industry' },
  },
  [`POST ${BASE}/clients/:id/status`]: {
    params: { id: 'payrollClient' },
    body: { status: 'PROCESSING' },
  },
  [`POST ${BASE}/clients/:id/pause`]: { params: { id: 'payrollClient' } },
  // Not paused: found, then refused with a 409.
  [`POST ${BASE}/clients/:id/resume`]: { params: { id: 'payrollClient' }, expect: 409 },
  [`POST ${BASE}/clients/:id/archive`]: { params: { id: 'payrollClient' } },
  [`POST ${BASE}/clients/:id/remove-service`]: {
    params: { id: 'payrollClient' },
    body: { reason: 'Fake reason' },
  },
  [`POST ${BASE}/clients/:id/assign`]: {
    params: { id: 'payrollClient' },
    bodyIds: { assignedUserId: 'adminUser' },
  },
  [`POST ${BASE}/clients/:id/frequency`]: {
    params: { id: 'payrollClient' },
    body: { frequency: 'MONTHLY' },
  },
  [`POST ${BASE}/clients/:id/plan`]: {
    params: { id: 'payrollClient' },
    body: { plan: 'Fake plan' },
  },
  [`GET ${BASE}/clients/:id/changes`]: { params: { id: 'payrollClient' } },
  // Not connected to a provider: found, then refused with a 409.
  [`POST ${BASE}/clients/:id/sync`]: { params: { id: 'payrollClient' }, expect: 409 },
  [`GET ${BASE}/clients/:id/activities`]: { params: { id: 'payrollClient' } },
  [`POST ${BASE}/clients/:id/activities`]: {
    params: { id: 'payrollClient' },
    body: { kind: 'CLIENT_CALL', summary: 'Fake call' },
  },
  [`GET ${BASE}/clients/:id/filings`]: { params: { id: 'payrollClient' } },
  [`GET ${BASE}/clients/:id/year-end`]: { params: { id: 'payrollClient' } },
  [`PUT ${BASE}/clients/:id/year-end/:taxYear`]: {
    params: { id: 'payrollClient' },
    body: { exceptionsNote: 'Fake note' },
  },
  [`GET ${BASE}/clients/:id/reports`]: { params: { id: 'payrollClient' } },
  [`POST ${BASE}/clients/:id/reports`]: {
    params: { id: 'payrollClient' },
    bodyIds: { documentId: 'document', runId: 'payrollRun' },
    body: { kind: 'REGISTER', periodStart: '2030-01-01', periodEnd: '2030-01-15' },
  },

  // ---------- Workers ----------
  [`GET ${BASE}/clients/:id/workers`]: { params: { id: 'payrollClient' } },
  [`POST ${BASE}/clients/:id/workers`]: {
    params: { id: 'payrollClient' },
    body: { displayName: 'Fake New Worker', workerType: 'PART_TIME' },
  },
  [`PATCH ${BASE}/clients/:id/workers/:workerId`]: {
    params: { id: 'payrollClient', workerId: 'payrollWorker' },
    body: { jobTitle: 'Fake title' },
  },

  // ---------- Runs ----------
  [`GET ${BASE}/clients/:id/runs`]: { params: { id: 'payrollClient' } },
  [`POST ${BASE}/clients/:id/runs`]: {
    params: { id: 'payrollClient' },
    body: { periodStart: '2031-06-01', periodEnd: '2031-06-15', payDate: '2031-06-19' },
  },
  [`GET ${BASE}/runs/:id`]: { params: { id: 'payrollRun' } },
  [`PATCH ${BASE}/runs/:id`]: { params: { id: 'payrollRun' }, body: { step: 2 } },
  [`GET ${BASE}/runs/:id/export`]: { params: { id: 'payrollRun' } },
  [`GET ${BASE}/runs/:id/lines`]: { params: { id: 'payrollRun' } },
  [`PUT ${BASE}/runs/:id/lines`]: {
    params: { id: 'payrollRun' },
    body: lines,
    bodyIds: { 'lines.workerId': 'payrollWorker' },
  },
  [`GET ${BASE}/runs/:id/issues`]: { params: { id: 'payrollRun' } },
  [`POST ${BASE}/runs/:id/issues/check`]: { params: { id: 'payrollRun' } },
  [`PATCH ${BASE}/runs/:id/issues/:issueId`]: {
    params: { id: 'payrollRun', issueId: 'payrollRunIssue' },
    body: { resolved: true },
  },
  [`POST ${BASE}/runs/:id/save-draft`]: { params: { id: 'payrollRun' } },
  [`POST ${BASE}/runs/:id/ready`]: { params: { id: 'payrollRun' } },
  [`POST ${BASE}/runs/:id/approve`]: { params: { id: 'payrollRunReady' } },
  [`POST ${BASE}/runs/:id/submit`]: {
    params: { id: 'payrollRunApproved' },
    body: { providerConfirmation: 'FAKE-REF-1' },
  },
  [`POST ${BASE}/runs/:id/complete`]: { params: { id: 'payrollRunSubmitted' } },
  [`POST ${BASE}/runs/:id/reopen`]: {
    params: { id: 'payrollRunReopen' },
    body: { reason: 'Fake reason' },
  },

  // ---------- Settings ----------
  [`PUT ${BASE}/settings`]: {
    params: {},
    bodyIds: { defaultAssigneeId: 'adminUser' },
    body: { reminderDaysBefore: 3, staleAfterHours: 48 },
  },
};
