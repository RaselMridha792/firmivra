// Demo seed, stage 5 (R0, Oct 19): the Bookkeeping module for the demo firm. The firm's close
// checklist; a profile and activity for every bookkeeping client (on track, needs attention,
// missing documents, overdue); and for three of them the whole month-end picture: a QuickBooks or
// Xero connection with its sync runs and accounts, the month before last closed (reconciled,
// approved) and last month in progress, last month's ledger (categorized, split, a transfer pair, a
// refund, a processor payout matched to its settlement, two still uncategorized), the reports
// (one delivered), and the engagement terms in force. Patterned on LVP's seed (seed-r38.ts), which
// passes the same database rules. Synthetic data; a client already seeded is left alone.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, DEMO_ENGAGEMENTS } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A calendar month `back` months before this one: its first and last day, label and key. */
const month = (back: number) => {
  const now = demoDay(0);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const at = (d: number, h = 12) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d, h));
  return {
    start,
    end,
    at,
    label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
  };
};

const STATUSES = [
  'ON_TRACK',
  'NEEDS_ATTENTION',
  'ON_TRACK',
  'MISSING_DOCUMENTS',
  'OVERDUE',
] as const;
const REASONS: Readonly<Record<(typeof STATUSES)[number], string>> = {
  ON_TRACK: 'No outstanding items',
  NEEDS_ATTENTION: 'Bank feed has 9 uncategorized transactions',
  MISSING_DOCUMENTS: 'Waiting on the client for card statements',
  OVERDUE: 'Last month is past its close date',
};

const CLOSE_STEPS = [
  ['categorization', 'Transactions categorized'],
  ['reconciliations', 'Bank and card accounts reconciled'],
  ['reports', 'Reports generated'],
  ['approval', 'Reviewer approval'],
] as const;

/** The three clients with the full month-end picture: provider, company, scale. */
const FULL = [
  { provider: 'quickbooks', processor: 'stripe', scale: 1 },
  { provider: 'xero', processor: 'square', scale: 1.6 },
  { provider: 'quickbooks', processor: 'stripe', scale: 0.7 },
] as const;

export async function seedDemoBookkeeping(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const books = DEMO_ENGAGEMENTS.filter((e) => e.slot === 'books' && e.status === 'ACTIVE');

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.bookkeepingSettings.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        closeChecklist: [
          { key: 'categorization', label: 'Transactions categorized', required: true },
          { key: 'reconciliations', label: 'Bank and card accounts reconciled', required: true },
          { key: 'reports', label: 'Reports generated', required: true },
          { key: 'approval', label: 'Reviewer approval', required: true },
          { key: 'delivery', label: 'Delivered to the client', required: false },
        ],
        documentChecklist: [
          { label: 'Bank statements', cadence: 'MONTHLY' },
          { label: 'Credit card statements', cadence: 'MONTHLY' },
          { label: 'Loan statements', cadence: 'QUARTERLY' },
        ],
      },
    });
    for (const [j, e] of books.entries()) {
      const profileId = demoId(`bk:${e.clientKey}:profile`);
      if (await tx.bookkeepingProfile.findUnique({ where: { id: profileId } })) continue;
      const status = STATUSES[j % STATUSES.length]!;
      await tx.bookkeepingProfile.create({
        data: {
          id: profileId,
          businessId,
          engagementId: e.id,
          cadence: 'MONTHLY',
          closeTargetDay: 10,
          nextReportDueOn: month(-1).at(15),
          status,
          statusSource: status === 'ON_TRACK' ? 'AUTOMATIC' : 'MANUAL',
          statusReason: REASONS[status],
          reviewerUserId: user('manager'),
          portalDefaults: { reports: true, tasks: false, documents: true, notes: false },
          alerts: {
            missingDocuments: true,
            staleSync: true,
            overdueClose: true,
            failedIntegration: true,
          },
        },
      });
      for (const [k, kind, summary] of [
        [0, 'STATUS_CHANGE', `Status set to ${status.replace('_', ' ').toLowerCase()}`],
        [1, 'REPORT', `${month(2).label} report delivered`],
      ] as const) {
        await tx.bookkeepingActivity.create({
          data: {
            id: demoId(`bk:${e.clientKey}:activity:${k}`),
            businessId,
            engagementId: e.id,
            kind,
            summary,
            actorUserId: user('bookkeeper'),
          },
        });
      }
      if (j < FULL.length) await seedMonthEnd(tx, org, e.clientKey, e.id, FULL[j]!);
    }
  });
}

/** One client's connection, accounts, periods, ledger, reports and terms. */
async function seedMonthEnd(
  tx: TxClient,
  org: DemoOrgResult,
  clientKey: string,
  engagementId: string,
  f: (typeof FULL)[number],
) {
  const { businessId } = org;
  const id = (part: string) => demoId(`bk:${clientKey}:${part}`);
  const base = { businessId, engagementId };
  const cents = (n: number) => Math.round(n * f.scale);
  const closed = month(2);
  const open = month(1);
  const company = (
    await tx.client.findUniqueOrThrow({
      where: { id: org.clients[clientKey]! },
      select: { displayName: true },
    })
  ).displayName;

  // Connection, sync runs and accounts.
  const connectionId = id('connection');
  const syncedAt = demoDay(-1);
  await tx.bookkeepingConnection.create({
    data: {
      ...base,
      id: connectionId,
      provider: f.provider,
      providerCompanyId: `${f.provider}-${clientKey}`,
      companyName: company,
      credentialRef: `local/demo/${f.provider}-${clientKey}`,
      lastSyncAt: syncedAt,
      lastSuccessfulSyncAt: syncedAt,
      connectedByUserId: user('bookkeeper'),
    },
  });
  for (const [k, outcome, ago] of [
    [0, 'SUCCESS', 8],
    [1, 'SUCCESS', 1],
  ] as const) {
    await tx.bookkeepingSyncRun.create({
      data: {
        id: id(`sync:${k}`),
        businessId,
        connectionId,
        trigger: k === 0 ? 'SCHEDULED' : 'MANUAL',
        outcome,
        startedAt: demoDay(-ago),
        finishedAt: new Date(demoDay(-ago).getTime() + 9_000),
        counts: { accounts: 2, transactions: 40 + k * 12 },
        ...(k === 1 ? { requestedByUserId: user('bookkeeper') } : {}),
      },
    });
  }
  const checkingId = id('account:checking');
  const cardId = id('account:card');
  for (const [accountId, name, type, mask, balance] of [
    [checkingId, 'Business Checking', 'BANK', `1${clientKey}4`, cents(1_845_032)],
    [cardId, 'Business Card', 'CREDIT_CARD', `2${clientKey}8`, -cents(334_012)],
  ] as const) {
    await tx.bookkeepingAccount.create({
      data: {
        ...base,
        id: accountId,
        connectionId,
        sourceAccountId: `acct-${mask}`,
        name,
        type,
        institution: 'Peachtree Community Bank',
        mask,
        balanceCents: balance,
        balanceAsOf: syncedAt,
      },
    });
  }

  // The month before last: reconciled, approved and closed. Last month: in progress.
  const items = (periodId: string, done: boolean) =>
    tx.bookkeepingCloseItem.createMany({
      data: CLOSE_STEPS.map(([itemKey, label], position) => ({
        id: id(`period:${periodId === id('period:closed') ? 'closed' : 'open'}:item:${itemKey}`),
        businessId,
        periodId,
        itemKey,
        label,
        position,
        ...(done || position === 0
          ? {
              completedAt: done ? open.at(8, 15) : demoDay(-2),
              completedByUserId: user('bookkeeper'),
            }
          : {}),
      })),
    });
  const closedId = id('period:closed');
  await tx.bookkeepingPeriod.create({
    data: {
      ...base,
      id: closedId,
      label: closed.label,
      periodStart: closed.start,
      periodEnd: closed.end,
      closeByOn: open.at(10),
      incomeCents: cents(2_190_000),
      expensesCents: cents(1_500_000),
      figuresSource: 'MANUAL',
      figuresAsOf: open.at(8),
      uncategorizedCount: 0,
    },
  });
  await items(closedId, true);
  await tx.bookkeepingReconciliation.create({
    data: {
      id: id('recon:closed'),
      businessId,
      periodId: closedId,
      accountId: checkingId,
      statementStart: closed.start,
      statementEnd: closed.end,
      beginningBalanceCents: cents(1_600_000),
      endingBalanceCents: cents(1_680_000),
      clearedBalanceCents: cents(1_680_000),
      clearedCount: 42,
      differenceCents: 0,
      status: 'APPROVED',
      readyForReviewAt: open.at(9, 15),
      approvedAt: open.at(9, 16),
      approvedBy: user('manager'),
    },
  });
  for (const [status, data] of [
    ['IN_PROGRESS', {}],
    [
      'READY_FOR_REVIEW',
      { readyForReviewAt: open.at(9, 15), readyForReviewBy: user('bookkeeper') },
    ],
    ['APPROVED', { approvedAt: open.at(9, 16), approvedBy: user('manager') }],
    ['CLOSED', { closedAt: open.at(9, 17), closedBy: user('manager') }],
  ] as const) {
    await tx.bookkeepingPeriod.update({ where: { id: closedId }, data: { status, ...data } });
  }
  const openId = id('period:open');
  await tx.bookkeepingPeriod.create({
    data: {
      ...base,
      id: openId,
      label: open.label,
      periodStart: open.start,
      periodEnd: open.end,
      status: 'IN_PROGRESS',
      closeByOn: month(0).at(10),
      incomeCents: cents(2_458_000),
      expensesCents: cents(1_622_000),
      figuresSource: 'MANUAL',
      figuresAsOf: syncedAt,
      uncategorizedCount: 2,
    },
  });
  await items(openId, false);
  await tx.bookkeepingReconciliation.create({
    data: {
      id: id('recon:open'),
      businessId,
      periodId: openId,
      accountId: checkingId,
      statementStart: open.start,
      statementEnd: open.end,
      beginningBalanceCents: cents(1_680_000),
      endingBalanceCents: cents(1_845_032),
      clearedBalanceCents: cents(1_840_000),
      clearedCount: 31,
      differenceCents: cents(1_845_032) - cents(1_840_000),
      exceptionsCount: 2,
    },
  });

  // Last month's ledger.
  const category = (key: string) => id(`category:${key}`);
  for (const [key, name, type] of [
    ['sales', 'Sales', 'INCOME'],
    ['software', 'Software & Subscriptions', 'EXPENSE'],
    ['supplies', 'Office Supplies', 'EXPENSE'],
    ['fees', 'Merchant Fees', 'EXPENSE'],
    ['meals', 'Meals', 'EXPENSE'],
  ] as const) {
    await tx.bookkeepingCategory.create({ data: { ...base, id: category(key), name, type } });
  }
  const synced = { connectionId, source: 'SYNC' as const };
  const checking = { ...base, ...synced, accountId: checkingId };
  const card = { ...base, ...synced, accountId: cardId };
  const payout = cents(482_500);
  const fees = cents(12_500);
  const refunds = cents(5_000);
  await tx.bookkeepingTransaction.create({
    data: {
      ...checking,
      id: id('tx:payout'),
      sourceTransactionId: `bank-${open.key}-05`,
      transactionDate: open.at(5),
      description: `${f.processor.toUpperCase()} TRANSFER`,
      payee: f.processor === 'stripe' ? 'Stripe' : 'Square',
      amountCents: payout,
      direction: 'CREDIT',
      kind: 'PAYOUT',
      status: 'CATEGORIZED',
      categoryId: category('sales'),
    },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: id('tx:software'),
      sourceTransactionId: `card-${open.key}-08`,
      transactionDate: open.at(8),
      description: 'INTUIT *QBOOKS ONLINE',
      payee: 'Intuit',
      amountCents: 9_000,
      direction: 'DEBIT',
      status: 'CATEGORIZED',
      categoryId: category('software'),
    },
  });
  const suppliesTotal = cents(18_250);
  const suppliesSoftware = cents(6_250);
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: id('tx:supplies'),
      sourceTransactionId: `card-${open.key}-12`,
      transactionDate: open.at(12),
      description: 'OFFICE DEPOT #1123',
      payee: 'Office Depot',
      amountCents: suppliesTotal,
      direction: 'DEBIT',
      status: 'CATEGORIZED',
    },
  });
  for (const [k, categoryId, amountCents, memo] of [
    [0, category('supplies'), suppliesTotal - suppliesSoftware, 'Toner and paper'],
    [1, category('software'), suppliesSoftware, 'Label software licence'],
  ] as const) {
    await tx.bookkeepingTransactionSplit.create({
      data: {
        ...base,
        id: id(`tx:supplies:split:${k}`),
        transactionId: id('tx:supplies'),
        categoryId,
        amountCents,
        memo,
      },
    });
  }
  const transfer = cents(150_000);
  await tx.bookkeepingTransaction.create({
    data: {
      ...checking,
      id: id('tx:transfer-out'),
      sourceTransactionId: `bank-${open.key}-15`,
      transactionDate: open.at(15),
      description: 'PAYMENT TO CARD',
      amountCents: transfer,
      direction: 'DEBIT',
      kind: 'TRANSFER',
    },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: id('tx:transfer-in'),
      sourceTransactionId: `card-${open.key}-15`,
      transactionDate: open.at(15),
      description: 'PAYMENT RECEIVED - THANK YOU',
      amountCents: transfer,
      direction: 'CREDIT',
      kind: 'TRANSFER',
    },
  });
  await tx.bookkeepingTransaction.update({
    where: { id: id('tx:transfer-out') },
    data: { transferPairId: id('tx:transfer-in'), status: 'CATEGORIZED' },
  });
  await tx.bookkeepingTransaction.update({
    where: { id: id('tx:transfer-in') },
    data: { transferPairId: id('tx:transfer-out'), status: 'CATEGORIZED' },
  });
  const refund = cents(3_500);
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: id('tx:refund'),
      sourceTransactionId: `card-${open.key}-20`,
      transactionDate: open.at(20),
      description: 'OFFICE DEPOT #1123 RETURN',
      payee: 'Office Depot',
      amountCents: refund,
      direction: 'CREDIT',
      kind: 'REFUND',
      status: 'CATEGORIZED',
      categoryId: category('supplies'),
    },
  });
  await tx.bookkeepingRefund.create({
    data: {
      ...base,
      id: id('refund'),
      kind: 'REFUND_RECEIVED',
      originalTransactionId: id('tx:supplies'),
      transactionId: id('tx:refund'),
      refundDate: open.at(20),
      amountCents: refund,
      reason: 'Returned an unopened toner cartridge.',
      method: 'Card credit',
      status: 'COMPLETED',
      categoryId: category('supplies'),
    },
  });
  // Still to categorize: the period's uncategorized list.
  for (const [k, description, amountCents, d] of [
    [0, 'SQ *CORNER CAFE', 4_275, 22],
    [1, 'AMZN MKTP US', 12_899, 26],
  ] as const) {
    await tx.bookkeepingTransaction.create({
      data: {
        ...card,
        id: id(`tx:uncategorized:${k}`),
        sourceTransactionId: `card-${open.key}-${d}`,
        transactionDate: open.at(d),
        description,
        amountCents,
        direction: 'DEBIT',
      },
    });
  }
  await tx.bookkeepingSettlement.create({
    data: {
      ...base,
      id: id('settlement'),
      connectionId,
      processor: f.processor,
      sourceSettlementId: `po_${open.key}_05_${clientKey}`,
      periodStart: open.start,
      periodEnd: open.at(3),
      payoutDate: open.at(5),
      grossCents: payout + fees + refunds,
      refundsCents: refunds,
      feesCents: fees,
      netPayoutCents: payout,
      netSource: 'CALCULATED',
      depositTransactionId: id('tx:payout'),
      status: 'MATCHED',
      matchedByUserId: user('bookkeeper'),
    },
  });

  // Reports: last month's P&L in progress (with a first version), the quarter's balance sheet
  // not started, and the closed month's reconciliation delivered.
  const plId = id('report:pl');
  await tx.bookkeepingReport.create({
    data: {
      ...base,
      id: plId,
      periodId: openId,
      reportType: 'PROFIT_LOSS',
      periodLabel: open.label,
      basis: 'ACCRUAL',
      dueOn: month(0).at(15),
      status: 'IN_PROGRESS',
    },
  });
  await tx.bookkeepingReportVersion.create({
    data: {
      ...base,
      id: id('report:pl:v1'),
      reportId: plId,
      version: 1,
      parameters: { period: open.key, basis: 'ACCRUAL', compare: 'PRIOR_MONTH' },
      summary: {
        incomeCents: payout,
        expensesCents: 9_000 + suppliesTotal - refund,
        netCents: payout - (9_000 + suppliesTotal - refund),
      },
      generatedByUserId: user('bookkeeper'),
    },
  });
  await tx.bookkeepingReport.create({
    data: {
      ...base,
      id: id('report:balance-sheet'),
      reportType: 'BALANCE_SHEET',
      periodLabel: `Q${Math.floor(open.start.getUTCMonth() / 3) + 1} ${open.start.getUTCFullYear()}`,
      dueOn: month(0).at(20),
    },
  });
  const published = open.at(9, 18);
  const engagementReportId = id('engagement-report:recon');
  await tx.engagementReport.create({
    data: {
      id: engagementReportId,
      businessId,
      engagementId,
      kind: 'RECONCILIATION',
      title: 'Business checking reconciliation',
      periodLabel: closed.label,
      status: 'PUBLISHED',
      publishedAt: published,
      data: { statementBalanceCents: cents(1_680_000), bookBalanceCents: cents(1_680_000) },
      createdByUserId: user('bookkeeper'),
    },
  });
  const reconReport = id('report:recon');
  await tx.bookkeepingReport.create({
    data: {
      ...base,
      id: reconReport,
      periodId: closedId,
      reportType: 'RECONCILIATION',
      periodLabel: closed.label,
      dueOn: open.at(15),
      engagementReportId,
    },
  });
  for (const [status, data] of [
    ['IN_PROGRESS', {}],
    ['IN_REVIEW', { generatedAt: open.at(9, 12), generatedByUserId: user('bookkeeper') }],
    ['APPROVED', { reviewedAt: open.at(9, 14), reviewedByUserId: user('manager') }],
    ['DELIVERED', { deliveredAt: open.at(10, 9), deliveredByUserId: user('manager') }],
  ] as const) {
    await tx.bookkeepingReport.update({ where: { id: reconReport }, data: { status, ...data } });
  }

  // The engagement terms in force since the client started.
  const termsId = id('terms');
  const since = month(8).start;
  await tx.bookkeepingTerms.create({
    data: {
      ...base,
      id: termsId,
      version: 1,
      packageName: 'Monthly Bookkeeping',
      startDate: since,
      renewalType: 'AUTO',
      noticeDays: 30,
      billingFrequency: 'MONTHLY',
      billingTiming: 'ADVANCE',
      paymentTerms: 'NET_15',
      preferredPaymentMethod: 'ACH',
      monthlyFeeCents: Math.round((45_000 * f.scale) / 5_000) * 5_000,
      setupFeeCents: 25_000,
      includedServices: [
        'Monthly categorization',
        'Bank and card reconciliations',
        'Monthly P&L and balance sheet',
      ],
      excludedServices: ['Payroll processing', 'Tax return preparation', 'Sales tax filings'],
      deliverables: ['Monthly close by the 10th', 'One review call per quarter'],
      clientResponsibilities: [
        'Upload statements and receipts by the 5th',
        'Answer questions within 3 business days',
      ],
      firmResponsibilities: ['Close each month by the 10th', 'Flag unusual transactions'],
      effectiveFrom: since,
    },
  });
  await tx.bookkeepingTermsEvent.create({
    data: {
      id: id('terms:created'),
      businessId,
      termsId,
      kind: 'CREATED',
      actorUserId: user('bookkeeper'),
    },
  });
  await tx.bookkeepingTerms.update({ where: { id: termsId }, data: { status: 'ACTIVE' } });
  await tx.bookkeepingTermsEvent.create({
    data: {
      id: id('terms:activated'),
      businessId,
      termsId,
      kind: 'ACTIVATED',
      effectiveDate: since,
      actorUserId: user('manager'),
    },
  });
}
