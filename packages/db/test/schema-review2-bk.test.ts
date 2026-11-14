// Octavia's Review 2 for Bookkeeping (R56, Rasel's approval Nov 14; migrations
// r56_bk_report_types_refund_settlement and r56_bk_review2): opening balances (R1's handoff), the
// reconciliation discrepancy note (R01), a Terms package from the catalog (E01b), a note's type,
// related record and visibility (N04), the P&L source (RP03) and the REFUND and SETTLEMENT report
// types (RP01). Each refuses another firm. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let eng: string;
let account: string;
let otherClientAccount: string;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56bk2');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
  account = (
    await A().bookkeepingAccount.create({
      data: { businessId: f.firmA, engagementId: eng, name: 'Fake checking', type: 'BANK' },
    })
  ).id;
  const other = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.client.create({ data: { businessId: f.firmA, displayName: 'Other Client (fake)' } }),
  );
  const otherEng = await createEngagement(owner, f.firmA, other.id);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: otherEng } });
  otherClientAccount = (
    await A().bookkeepingAccount.create({
      data: { businessId: f.firmA, engagementId: otherEng, name: 'Other checking', type: 'BANK' },
    })
  ).id;
});

const balance = (data: Record<string, unknown> = {}) =>
  A().bookkeepingOpeningBalance.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      accountId: account,
      asOf: new Date('2026-01-01'),
      amountCents: 1_250_000n,
      createdByUserId: f.memberA,
      ...data,
    },
  });

describe('opening balances', () => {
  it('one per account and date, on the client’s own account; firm B sees and writes none', async () => {
    const row = await balance();
    expect(row.amountCents).toBe(1_250_000n);
    expect(await failure(balance())).toMatch(/Unique constraint/i);
    // Another client's account is refused, and a balance keeps its client and account.
    expect(
      await failure(balance({ accountId: otherClientAccount, asOf: new Date('2026-02-01') })),
    ).toMatch(/not this client's/);
    expect(
      await failure(
        A().bookkeepingOpeningBalance.update({
          where: { id: row.id },
          data: { accountId: otherClientAccount },
        }),
      ),
    ).toMatch(/cannot change/);
    // A negative opening balance (a card owed) is allowed.
    await balance({ asOf: new Date('2026-03-01'), amountCents: -40_000n });
    expect(await B().bookkeepingOpeningBalance.count()).toBe(0);
    expect(
      await failure(
        B().bookkeepingOpeningBalance.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            accountId: account,
            asOf: new Date('2026-04-01'),
            amountCents: 1n,
          },
        }),
      ),
    ).toMatch(/row-level security|foreign key|not this client's/i);
  });
});

describe('a reconciliation’s discrepancy note', () => {
  it('is all of note, who and when, or none, and never empty', async () => {
    const period = await A().bookkeepingPeriod.create({
      data: {
        businessId: f.firmA,
        engagementId: eng,
        kind: 'MONTH',
        label: 'Fake Jan 2026',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
      },
    });
    const recon = await A().bookkeepingReconciliation.create({
      data: {
        businessId: f.firmA,
        periodId: period.id,
        accountId: account,
        statementStart: new Date('2026-01-01'),
        statementEnd: new Date('2026-01-31'),
        beginningBalanceCents: 0,
        endingBalanceCents: 1000,
        differenceCents: 1000,
      },
    });
    const note = (data: Record<string, unknown>) =>
      A().bookkeepingReconciliation.update({ where: { id: recon.id }, data });
    expect(await failure(note({ discrepancyNote: 'Fake: bank fee' }))).toMatch(/discrepancy_note/);
    expect(
      await failure(
        note({
          discrepancyNote: '  ',
          discrepancyNoteBy: f.memberA,
          discrepancyNoteAt: new Date(),
        }),
      ),
    ).toMatch(/discrepancy_note/);
    const saved = await note({
      discrepancyNote: 'Fake: a $10 bank fee posts next month',
      discrepancyNoteBy: f.memberA,
      discrepancyNoteAt: new Date(),
    });
    expect(saved.discrepancyNote).toMatch(/bank fee/);
  });
});

describe('notes, Terms, the P&L source and the report types', () => {
  it('a note is internal by default, with a known related record or none', async () => {
    const make = (data: Record<string, unknown>) =>
      A().note.create({
        data: {
          businessId: f.firmA,
          clientId: f.clientA,
          body: 'Fake note',
          authorUserId: f.memberA,
          ...data,
        },
      });
    const plain = await make({});
    expect(plain.visibility).toBe('INTERNAL');
    const typed = await make({
      noteType: 'Call',
      relatedKind: 'reconciliation',
      relatedId: plain.id,
    });
    expect(typed.relatedKind).toBe('reconciliation');
    expect(await failure(make({ relatedKind: 'task' }))).toMatch(/notes_type_and_related/);
    expect(await failure(make({ relatedKind: 'invoice', relatedId: plain.id }))).toMatch(
      /notes_type_and_related/,
    );
    expect(await failure(make({ noteType: '' }))).toMatch(/notes_type_and_related/);
  });

  it('a Terms package links the catalog service; deleting the service clears only that link', async () => {
    const service = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.service.create({
        data: { businessId: f.firmA, kind: 'BOOKKEEPING', name: 'Fake Growth' },
      }),
    );
    const terms = await A().bookkeepingTerms.create({
      data: {
        businessId: f.firmA,
        engagementId: eng,
        version: 1,
        startDate: new Date('2026-01-01'),
        effectiveFrom: new Date('2026-01-01'),
        packageName: 'Fake Growth',
        catalogServiceId: service.id,
      },
    });
    expect(terms.catalogServiceId).toBe(service.id);
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.service.delete({ where: { id: service.id } }),
    );
    const after = await A().bookkeepingTerms.findUniqueOrThrow({ where: { id: terms.id } });
    expect(after).toMatchObject({
      catalogServiceId: null,
      businessId: f.firmA,
      packageName: 'Fake Growth',
    });
  });

  it('a client’s P&L source, and REFUND and SETTLEMENT reports', async () => {
    const p = await A().bookkeepingProfile.update({
      where: { businessId_engagementId: { businessId: f.firmA, engagementId: eng } },
      data: { pnlSource: 'MANUAL' },
    });
    expect(p.pnlSource).toBe('MANUAL');
    for (const reportType of ['REFUND', 'SETTLEMENT'] as const) {
      const r = await A().bookkeepingReport.create({
        data: { businessId: f.firmA, engagementId: eng, reportType, periodLabel: 'Fake Q1 2026' },
      });
      expect(r.reportType).toBe(reportType);
    }
  });
});
