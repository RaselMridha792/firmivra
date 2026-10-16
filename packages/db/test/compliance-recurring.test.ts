// Compliance & Deadlines, part 3 (R38): recurring deadline definitions, applicability rules and
// their decisions. Isolation between firms and the rules of migration r38_compliance_recurring.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let otherClientA: string;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
const recurrence = (data: Record<string, unknown> = {}) =>
  A().complianceRecurrence.create({
    data: {
      businessId: f.firmA,
      name: `Quarterly tax ${randomUUID()}`,
      type: 'ESTIMATED_TAX',
      frequency: 'QUARTERLY',
      startOn: day('2027-01-15'),
      ...data,
    },
  });
const rule = (recurrenceId: string, data: Record<string, unknown> = {}) =>
  A().complianceApplicabilityRule.create({
    data: { businessId: f.firmA, name: 'Rule (fake)', recurrenceId, ...data },
  });
const deadline = (data: Record<string, unknown> = {}, clientId = () => f.clientA) =>
  A().complianceDeadline.create({
    data: {
      businessId: f.firmA,
      clientId: clientId(),
      name: 'Deadline (fake)',
      type: 'ESTIMATED_TAX',
      dueOn: day('2027-01-15'),
      ...data,
    },
  });
const record = (ruleId: string, data: Record<string, unknown> = {}) =>
  A().complianceApplicabilityRecord.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      ruleId,
      ruleVersion: 1,
      dueOn: day('2027-01-15'),
      decision: 'SUGGESTED',
      reason: 'Individual with estimated tax: IRS calendar 2027, version 1',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38cr');
  otherClientA = (
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    )
  ).id;
});

describe('isolation', () => {
  it('another firm sees no recurrence, rule or decision', async () => {
    const r = await recurrence();
    const ru = await rule(r.id);
    await record(ru.id);
    const B = db.forBusiness(f.firmB);
    expect(await B.complianceRecurrence.findMany()).toEqual([]);
    expect(await B.complianceApplicabilityRule.findMany()).toEqual([]);
    expect(await B.complianceApplicabilityRecord.findMany()).toEqual([]);
    expect(
      await failure(
        B.complianceRecurrence.create({
          data: {
            businessId: f.firmA,
            name: 'x',
            type: 'OTHER',
            frequency: 'ANNUAL',
            startOn: day('2027-01-15'),
          },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("refuses another firm's recurrence, assignee or client", async () => {
    const recB = await db.forBusiness(f.firmB).complianceRecurrence.create({
      data: {
        businessId: f.firmB,
        name: 'B (fake)',
        type: 'OTHER',
        frequency: 'ANNUAL',
        startOn: day('2027-01-15'),
      },
    });
    expect(await failure(rule(recB.id))).toMatch(/foreign key/i);
    expect(await failure(deadline({ recurrenceId: recB.id }))).toMatch(/foreign key/i);
    expect(await failure(recurrence({ assignedUserId: f.memberB }))).toMatch(/foreign key/i);
    const ru = await rule((await recurrence()).id);
    expect(await failure(record(ru.id, { clientId: f.clientB }))).toMatch(/foreign key/i);
  });
});

describe('recurrences', () => {
  it('a custom frequency has its interval, and only that one', async () => {
    await expect(recurrence({ frequency: 'CUSTOM', interval: 2 })).resolves.toBeTruthy();
    for (const data of [
      { frequency: 'CUSTOM' },
      { interval: 2 },
      { frequency: 'CUSTOM', interval: 0 },
      { frequency: 'CUSTOM', interval: 366 },
    ]) {
      expect(await failure(recurrence(data))).toMatch(/check constraint/i);
    }
  });

  it('ends never, after N, or on a date; a live one starts, a template need not', async () => {
    await expect(recurrence({ endMode: 'AFTER_COUNT', endAfterCount: 4 })).resolves.toBeTruthy();
    await expect(
      recurrence({ endMode: 'ON_DATE', endOn: day('2028-01-15') }),
    ).resolves.toBeTruthy();
    await expect(recurrence({ isTemplate: true, startOn: null })).resolves.toBeTruthy();
    for (const data of [
      { startOn: null },
      { endMode: 'AFTER_COUNT' },
      { endMode: 'ON_DATE' },
      { endMode: 'ON_DATE', endOn: day('2026-01-01') },
      { endMode: 'NEVER', endOn: day('2028-01-15') },
    ]) {
      expect(await failure(recurrence(data))).toMatch(/check constraint/i);
    }
  });

  it('checks the state, reminders, task template, client notice and pause rules', async () => {
    for (const data of [
      { state: 'Georgia' },
      { reminders: {} },
      { reminders: new Array(11).fill({ daysBefore: 1 }) },
      { repeatRule: [] },
      { taskTemplateId: randomUUID() },
      { remindClient: true },
      { status: 'PAUSED' },
      { status: 'ENDED' },
      { name: ' ' },
    ]) {
      expect(await failure(recurrence(data))).toMatch(/check constraint|foreign key/i);
    }
    await expect(recurrence({ status: 'PAUSED', pausedAt: new Date() })).resolves.toBeTruthy();
  });

  it('a template makes no deadlines, a live recurrence may', async () => {
    const template = await recurrence({ isTemplate: true });
    const live = await recurrence();
    expect(await failure(deadline({ recurrenceId: template.id }))).toMatch(/template makes no/);
    await expect(deadline({ recurrenceId: live.id })).resolves.toBeTruthy();
  });
});

describe('applicability rules', () => {
  it('have exactly one target, valid states, and arrays of sane size', async () => {
    const r = await recurrence();
    const cal = await A().complianceCalendar.create({
      data: {
        businessId: f.firmA,
        family: 'IRS_GENERAL',
        authority: 'IRS',
        jurisdiction: 'FEDERAL',
        effectiveYear: 2050,
        name: 'IRS (fake)',
        sourceUrl: 'https://www.irs.gov/',
      },
    });
    const entry = await A().complianceCalendarEntry.create({
      data: {
        businessId: f.firmA,
        calendarId: cal.id,
        name: 'Entry',
        type: 'OTHER',
        ruleKind: 'NEEDS_VERIFICATION',
      },
    });
    for (const data of [
      { recurrenceId: null },
      { calendarEntryId: entry.id },
      { states: ['GA', 'Georgia'] },
      { states: ['XX'] },
      { entityTypes: new Array(31).fill('LLC') },
      { priorYearLiabilityOverCents: -1 },
      { criteria: [] },
      { name: ' ' },
    ]) {
      expect(await failure(rule(r.id, data))).toMatch(/check constraint/i);
    }
    await expect(
      A().complianceApplicabilityRule.create({
        data: { businessId: f.firmA, name: 'On an entry', calendarEntryId: entry.id },
      }),
    ).resolves.toMatchObject({ outcome: 'SUGGEST', version: 1 });
    await expect(
      rule(r.id, { states: ['GA', 'NC'], services: ['ANNUAL_TAX'], excludeStatuses: ['CLOSED'] }),
    ).resolves.toBeTruthy();
  });

  it('the database raises the version on every change, and only then', async () => {
    const ru = await rule((await recurrence()).id);
    const set = (data: Record<string, unknown>) =>
      A().complianceApplicabilityRule.update({ where: { id: ru.id }, data });
    expect((await set({ states: ['GA'] })).version).toBe(2);
    expect((await set({ version: 99, active: false })).version).toBe(3);
    expect((await set({ version: 1 })).version).toBe(3); // nothing changed
  });
});

describe('applicability decisions', () => {
  it('one per client, rule and date; confirming needs the deadline and a decision time', async () => {
    const ru = await rule((await recurrence()).id);
    await record(ru.id);
    expect(await failure(record(ru.id))).toMatch(/unique/i);
    const ru2 = await rule((await recurrence()).id);
    const d = await deadline();
    const decided = { decidedAt: new Date(), decidedByUserId: f.memberA };
    expect(await failure(record(ru2.id, { decision: 'CONFIRMED', ...decided }))).toMatch(
      /check constraint/i,
    );
    expect(await failure(record(ru2.id, { deadlineId: d.id }))).toMatch(/check constraint/i);
    expect(await failure(record(ru2.id, { decision: 'DISMISSED' }))).toMatch(/check constraint/i);
    expect(await failure(record(ru2.id, { reason: ' ' }))).toMatch(/check constraint/i);
    await expect(
      record(ru2.id, { decision: 'CONFIRMED', deadlineId: d.id, ...decided }),
    ).resolves.toBeTruthy();
    await expect(
      record(ru2.id, { decision: 'DISMISSED', dueOn: day('2027-04-15'), ...decided }),
    ).resolves.toBeTruthy();
    await expect(
      record(ru2.id, {
        decision: 'NEEDS_REVIEW',
        dueOn: day('2027-07-15'),
        reason: 'No entity type on file',
      }),
    ).resolves.toBeTruthy();
  });

  it("the deadline is the client's, one deadline per decision, and a decision keeps its identity", async () => {
    const ru = await rule((await recurrence()).id);
    const other = await deadline({}, () => otherClientA);
    const decided = { decidedAt: new Date(), decidedByUserId: f.memberA };
    expect(
      await failure(record(ru.id, { decision: 'CONFIRMED', deadlineId: other.id, ...decided })),
    ).toMatch(/must be the client's/);
    const d = await deadline();
    const rec = await record(ru.id, { decision: 'CONFIRMED', deadlineId: d.id, ...decided });
    expect(
      await failure(
        record(ru.id, {
          decision: 'CONFIRMED',
          deadlineId: d.id,
          dueOn: day('2027-04-15'),
          ...decided,
        }),
      ),
    ).toMatch(/unique/i);
    for (const data of [{ clientId: otherClientA }, { dueOn: day('2028-01-15') }]) {
      expect(
        await failure(A().complianceApplicabilityRecord.update({ where: { id: rec.id }, data })),
      ).toMatch(/keeps its client/);
    }
  });
});
