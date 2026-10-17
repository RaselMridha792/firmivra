// Bookkeeping (R38 Bookkeeping API): bookkeeping clients and their connections, accounts, periods
// with their close steps, reconciliations and reports. Each world has its own records on client
// X's Bookkeeping engagement (the `workspace` record).
import { randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef } from '../world.js';

const BASE = '/api/v1/business/bookkeeping';

/** Each period needs its own dates: a client has one period per start and end. */
let month = 0;
const nextMonth = () => {
  month += 1;
  const m = String((month % 12) + 1).padStart(2, '0');
  const y = 2030 + Math.floor(month / 12);
  const last = new Date(Date.UTC(y, Number(m), 0)).getUTCDate();
  return {
    periodStart: new Date(`${y}-${m}-01T00:00:00.000Z`),
    periodEnd: new Date(`${y}-${m}-${last}T00:00:00.000Z`),
    label: `Fake period ${month}`,
  };
};

type PeriodState = 'IN_PROGRESS' | 'READY_FOR_REVIEW' | 'APPROVED';

const period = (state: PeriodState, stepsDone: boolean): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, owner, get }) {
    const stamp = new Date('2030-01-01T00:00:00.000Z');
    const row = await tx.bookkeepingPeriod.create({
      data: {
        businessId,
        engagementId: await get('workspace'),
        status: state,
        ...nextMonth(),
        ...(state === 'IN_PROGRESS' ? {} : { readyForReviewAt: stamp, readyForReviewBy: owner.id }),
        ...(state === 'APPROVED' ? { approvedAt: stamp, approvedBy: owner.id } : {}),
      },
    });
    await tx.bookkeepingCloseItem.create({
      data: {
        businessId,
        periodId: row.id,
        itemKey: 'categorization',
        label: 'Fake categorization',
        required: true,
        position: 0,
        ...(stepsDone ? { completedAt: stamp, completedByUserId: owner.id } : {}),
      },
    });
    return row.id;
  },
});

const account = (name: string): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, get }) {
    return (
      await tx.bookkeepingAccount.create({
        data: {
          businessId,
          engagementId: await get('workspace'),
          name: `${name} ${randomUUID().slice(0, 6)}`,
          type: 'BANK',
          mask: '1234',
        },
      })
    ).id;
  },
});

const reconciliation = (state: 'IN_PROGRESS' | 'READY_FOR_REVIEW'): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, get }) {
    const accountRow = await tx.bookkeepingAccount.create({
      data: {
        businessId,
        engagementId: await get('workspace'),
        name: `Fake recon account ${randomUUID().slice(0, 6)}`,
        type: 'BANK',
      },
    });
    const row = await tx.bookkeepingReconciliation.create({
      data: {
        businessId,
        periodId: await get('bookkeepingPeriod'),
        accountId: accountRow.id,
        statementStart: new Date('2030-01-01T00:00:00.000Z'),
        statementEnd: new Date('2030-01-31T00:00:00.000Z'),
        beginningBalanceCents: 1000,
        endingBalanceCents: 5000,
        clearedBalanceCents: 5000,
        differenceCents: 0,
        status: state,
        ...(state === 'READY_FOR_REVIEW' ? { readyForReviewAt: new Date() } : {}),
      },
    });
    return row.id;
  },
});

type ReportState = 'NOT_STARTED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'APPROVED';
let reports = 0;

const report = (state: ReportState): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, owner, get }) {
    reports += 1;
    const stamp = new Date('2030-01-01T00:00:00.000Z');
    const row = await tx.bookkeepingReport.create({
      data: {
        businessId,
        engagementId: await get('workspace'),
        reportType: 'PROFIT_LOSS',
        periodLabel: `Fake report period ${reports}`,
        dueOn: new Date('2031-01-10T00:00:00.000Z'),
        status: state,
        ...(state === 'NOT_STARTED' ? {} : { generatedAt: stamp, generatedByUserId: owner.id }),
        ...(state === 'APPROVED' ? { reviewedAt: stamp, reviewedByUserId: owner.id } : {}),
      },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  /** Client X is a bookkeeping client (monthly, on track, nothing connected). */
  bookkeepingClient: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.bookkeepingProfile.create({
        data: { businessId, engagementId: await get('workspace'), status: 'ON_TRACK' },
      });
      return row.id;
    },
  },
  /** A client that is not on bookkeeping yet, for adding. */
  bookkeepingNewClient: {
    async create({ tx, businessId }) {
      return (
        await tx.client.create({
          data: {
            businessId,
            displayName: `Fake new bookkeeping client ${randomUUID().slice(0, 8)}`,
          },
        })
      ).id;
    },
  },
  /** A live QuickBooks connection of client X. */
  bookkeepingConnection: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      await get('bookkeepingClient');
      return (
        await tx.bookkeepingConnection.create({
          data: {
            businessId,
            engagementId: await get('workspace'),
            provider: 'quickbooks',
            providerCompanyId: `FAKE-${randomUUID().slice(0, 8)}`,
          },
        })
      ).id;
    },
  },
  /** An expired Xero connection of client X, for reconnecting. */
  bookkeepingConnectionExpired: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      await get('bookkeepingClient');
      return (
        await tx.bookkeepingConnection.create({
          data: {
            businessId,
            engagementId: await get('workspace'),
            provider: 'xero',
            providerCompanyId: `FAKE-${randomUUID().slice(0, 8)}`,
            status: 'EXPIRED',
          },
        })
      ).id;
    },
  },
  bookkeepingAccount: account('Fake checking'),
  bookkeepingPeriod: period('IN_PROGRESS', false),
  bookkeepingPeriodReady: period('READY_FOR_REVIEW', false),
  bookkeepingPeriodApproved: period('APPROVED', true),
  /** An optional step of the in-progress period. */
  bookkeepingCloseItem: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      return (
        await tx.bookkeepingCloseItem.create({
          data: {
            businessId,
            periodId: await get('bookkeepingPeriod'),
            itemKey: 'extra_step',
            label: 'Fake extra step',
            required: false,
            position: 99,
          },
        })
      ).id;
    },
  },
  bookkeepingReconciliation: reconciliation('IN_PROGRESS'),
  bookkeepingReconciliationReady: reconciliation('READY_FOR_REVIEW'),
  bookkeepingReport: report('NOT_STARTED'),
  bookkeepingReportStarted: report('IN_PROGRESS'),
  bookkeepingReportReview: report('IN_REVIEW'),
  bookkeepingReportApproved: report('APPROVED'),
  /** A report published for client X on their Bookkeeping workspace, to deliver against. */
  bookkeepingPublishedReport: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.engagementReport.create({
        data: {
          businessId,
          engagementId: await get('workspace'),
          kind: 'REPORT',
          title: 'Fake published report',
        },
      });
      await tx.engagementReport.update({
        where: { id: row.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      return row.id;
    },
  },
};

const client = { id: 'bookkeepingClient' };
const connection = { id: 'bookkeepingConnection' };
const periodId = { id: 'bookkeepingPeriod' };
const recon = { id: 'bookkeepingReconciliation' };
const reportId = { id: 'bookkeepingReport' };

export const cases: CaseModule['cases'] = {
  // ---------- Bookkeeping clients ----------
  [`POST ${BASE}/clients`]: {
    params: {},
    bodyIds: {
      clientId: 'bookkeepingNewClient',
      assignedUserId: 'adminUser',
      reviewerUserId: 'adminUser',
    },
    body: { cadence: 'QUARTERLY' },
  },
  [`GET ${BASE}/clients/:id`]: { params: client },
  [`PATCH ${BASE}/clients/:id`]: {
    params: client,
    bodyIds: { reviewerUserId: 'adminUser' },
    body: { alerts: { staleSync: false } },
  },
  [`POST ${BASE}/clients/:id/status`]: {
    params: client,
    body: { status: 'OVERDUE', reason: 'Fake reason' },
  },
  [`POST ${BASE}/clients/:id/pause`]: { params: client, body: { reason: 'Fake pause reason' } },
  // Not paused: found, then refused with a 409.
  [`POST ${BASE}/clients/:id/resume`]: { params: client, expect: 409 },
  [`POST ${BASE}/clients/:id/archive`]: { params: client },
  [`POST ${BASE}/clients/:id/assign`]: { params: client, bodyIds: { assignedUserId: 'adminUser' } },
  // Nothing connected: found, then refused with a 409.
  [`POST ${BASE}/clients/:id/sync`]: { params: client, expect: 409 },
  [`GET ${BASE}/clients/:id/activities`]: { params: client },
  [`POST ${BASE}/clients/:id/activities`]: {
    params: client,
    body: { kind: 'CONTACT', summary: 'Fake call with the client' },
  },

  // ---------- Connections and accounts ----------
  [`GET ${BASE}/clients/:id/connections`]: { params: client },
  [`POST ${BASE}/clients/:id/connections`]: {
    params: client,
    body: { provider: 'zoho_books', providerCompanyId: 'FAKE-ZOHO-1', companyName: 'Fake Co' },
  },
  [`PATCH ${BASE}/connections/:id`]: {
    params: connection,
    body: { companyName: 'Fake renamed Co' },
  },
  [`POST ${BASE}/connections/:id/disconnect`]: { params: connection },
  [`POST ${BASE}/connections/:id/reconnect`]: { params: { id: 'bookkeepingConnectionExpired' } },
  [`GET ${BASE}/connections/:id/syncs`]: { params: connection },
  [`GET ${BASE}/clients/:id/accounts`]: { params: client },
  [`POST ${BASE}/clients/:id/accounts`]: {
    params: client,
    body: { name: 'Fake new account', type: 'CREDIT_CARD', mask: '4321' },
  },
  [`PATCH ${BASE}/accounts/:id`]: {
    params: { id: 'bookkeepingAccount' },
    body: { name: 'Fake renamed account' },
  },

  // ---------- Periods and the close ----------
  [`GET ${BASE}/clients/:id/periods`]: { params: client },
  [`POST ${BASE}/clients/:id/periods`]: {
    params: client,
    body: { kind: 'MONTH', periodStart: '2035-03-01', periodEnd: '2035-03-31' },
  },
  [`GET ${BASE}/periods/:id`]: { params: periodId },
  [`PATCH ${BASE}/periods/:id`]: {
    params: periodId,
    body: { incomeCents: 10_000, expensesCents: 4_000 },
  },
  [`POST ${BASE}/periods/:id/start`]: { params: periodId, expect: 409 },
  [`POST ${BASE}/periods/:id/ready`]: { params: periodId },
  [`POST ${BASE}/periods/:id/send-back`]: { params: { id: 'bookkeepingPeriodReady' } },
  [`POST ${BASE}/periods/:id/approve`]: { params: { id: 'bookkeepingPeriodReady' } },
  [`POST ${BASE}/periods/:id/close`]: { params: { id: 'bookkeepingPeriodApproved' } },
  [`POST ${BASE}/periods/:id/reopen`]: {
    params: { id: 'bookkeepingPeriodApproved' },
    body: { reason: 'Fake reopen reason' },
  },
  [`PATCH ${BASE}/periods/:id/close-items/:itemId`]: {
    params: { id: 'bookkeepingPeriod', itemId: 'bookkeepingCloseItem' },
    body: { completed: true },
  },

  // ---------- Reconciliations ----------
  [`GET ${BASE}/periods/:id/reconciliations`]: { params: periodId },
  [`POST ${BASE}/periods/:id/reconciliations`]: {
    params: periodId,
    bodyIds: { accountId: 'bookkeepingAccount', statementDocumentId: 'workspaceDocument' },
    body: {
      statementStart: '2030-01-01',
      statementEnd: '2030-01-31',
      beginningBalanceCents: 1_000,
      endingBalanceCents: 5_000,
    },
  },
  [`GET ${BASE}/reconciliations/:id`]: { params: recon },
  [`PATCH ${BASE}/reconciliations/:id`]: {
    params: recon,
    bodyIds: { statementDocumentId: 'workspaceDocument' },
    body: { clearedBalanceCents: 4_000 },
  },
  [`POST ${BASE}/reconciliations/:id/ready`]: { params: recon },
  [`POST ${BASE}/reconciliations/:id/approve`]: {
    params: { id: 'bookkeepingReconciliationReady' },
  },
  [`POST ${BASE}/reconciliations/:id/reopen`]: {
    params: { id: 'bookkeepingReconciliationReady' },
    body: { reason: 'Fake reopen reason' },
  },

  // ---------- Reports ----------
  [`GET ${BASE}/clients/:id/reports`]: { params: client },
  [`POST ${BASE}/clients/:id/reports`]: {
    params: client,
    bodyIds: { periodId: 'bookkeepingPeriod' },
    body: { reportType: 'BALANCE_SHEET', periodLabel: 'Fake 2035 period' },
  },
  [`GET ${BASE}/reports/:id`]: { params: reportId },
  [`PATCH ${BASE}/reports/:id`]: { params: reportId, body: { basis: 'CASH' } },
  [`POST ${BASE}/reports/:id/start`]: { params: reportId },
  [`POST ${BASE}/reports/:id/submit-review`]: { params: { id: 'bookkeepingReportStarted' } },
  [`POST ${BASE}/reports/:id/send-back`]: { params: { id: 'bookkeepingReportReview' } },
  [`POST ${BASE}/reports/:id/approve`]: { params: { id: 'bookkeepingReportReview' } },
  [`POST ${BASE}/reports/:id/deliver`]: {
    params: { id: 'bookkeepingReportApproved' },
    bodyIds: { engagementReportId: 'bookkeepingPublishedReport' },
  },
};
