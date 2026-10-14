// Compliance & Deadlines, part 2 (R38): deadline documents and links, and the government
// Calendar Library. Isolation between firms and the rules of migration
// r38_compliance_calendars. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let otherClientA: string;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
const deadline = (data: Record<string, unknown> = {}, clientId = () => f.clientA) =>
  A().complianceDeadline.create({
    data: {
      businessId: f.firmA,
      clientId: clientId(),
      name: 'Deadline (fake)',
      type: 'ESTIMATED_TAX',
      dueOn: day('2026-10-15'),
      ...data,
    },
  });
let year = 2030;
const calendar = (data: Record<string, unknown> = {}) =>
  A().complianceCalendar.create({
    data: {
      businessId: f.firmA,
      family: 'IRS_GENERAL',
      authority: 'IRS',
      jurisdiction: 'FEDERAL',
      effectiveYear: ++year,
      name: 'IRS calendar (fake)',
      sourceUrl: 'https://www.irs.gov/publications/p509',
      ...data,
    },
  });
const entry = (calendarId: string, data: Record<string, unknown> = {}) =>
  A().complianceCalendarEntry.create({
    data: {
      businessId: f.firmA,
      calendarId,
      name: `Entry ${randomUUID()}`,
      type: 'TAX_FILING',
      ruleKind: 'FIXED_DATE',
      dueOn: day('2031-04-15'),
      ...data,
    },
  });
const setStatus = (id: string, status: string, data: Record<string, unknown> = {}) =>
  A().complianceCalendar.update({ where: { id }, data: { status: status as 'VERIFIED', ...data } });
const verify = (id: string) => setStatus(id, 'VERIFIED', { verifiedAt: new Date() });
const publish = (id: string) => setStatus(id, 'PUBLISHED', { publishedAt: new Date() });

async function documentOf(clientId: string) {
  return runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId: f.firmA, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
    });
    const engagement = await tx.engagement.create({
      data: { businessId: f.firmA, clientId, serviceId: service.id, title: 'Tax (fake)' },
    });
    const doc = await tx.document.create({
      data: {
        businessId: f.firmA,
        clientId,
        engagementId: engagement.id,
        direction: 'FIRM_TO_CLIENT',
        fileName: 'worksheet.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'c'.repeat(64),
        s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
      },
    });
    return doc.id;
  });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38cc');
  otherClientA = (
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    )
  ).id;
});

describe('isolation', () => {
  it('another firm sees no calendar, entry, document or link', async () => {
    const cal = await calendar();
    await entry(cal.id);
    const d1 = await deadline();
    const d2 = await deadline();
    await A().complianceDeadlineDocument.create({
      data: { businessId: f.firmA, deadlineId: d1.id, documentId: await documentOf(f.clientA) },
    });
    await A().complianceDeadlineLink.create({
      data: { businessId: f.firmA, deadlineId: d1.id, relatedDeadlineId: d2.id },
    });
    const B = db.forBusiness(f.firmB);
    expect(await B.complianceCalendar.findMany()).toEqual([]);
    expect(await B.complianceCalendarEntry.findMany()).toEqual([]);
    expect(await B.complianceDeadlineDocument.findMany()).toEqual([]);
    expect(await B.complianceDeadlineLink.findMany()).toEqual([]);
    expect(
      await failure(
        B.complianceCalendar.create({
          data: {
            businessId: f.firmA,
            family: 'IRS_GENERAL',
            authority: 'IRS',
            jurisdiction: 'FEDERAL',
            effectiveYear: 2040,
            name: 'x',
            sourceUrl: 'https://www.irs.gov/',
          },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("a deadline cannot point at another firm's library entry", async () => {
    const calB = await db.forBusiness(f.firmB).complianceCalendar.create({
      data: {
        businessId: f.firmB,
        family: 'IRS_GENERAL',
        authority: 'IRS',
        jurisdiction: 'FEDERAL',
        effectiveYear: 2031,
        name: 'B (fake)',
        sourceUrl: 'https://www.irs.gov/',
      },
    });
    const entryB = await db.forBusiness(f.firmB).complianceCalendarEntry.create({
      data: {
        businessId: f.firmB,
        calendarId: calB.id,
        name: 'B entry',
        type: 'OTHER',
        ruleKind: 'NEEDS_VERIFICATION',
      },
    });
    expect(await failure(deadline({ calendarEntryId: entryB.id }))).toMatch(/foreign key/i);
  });
});

describe('deadline documents and links', () => {
  it("a document must be the deadline client's, and goes with the document", async () => {
    const d = await deadline();
    const attach = (documentId: string) =>
      A().complianceDeadlineDocument.create({
        data: { businessId: f.firmA, deadlineId: d.id, documentId },
      });
    expect(await failure(attach(await documentOf(otherClientA)))).toMatch(
      /deadline client's documents/,
    );
    const doc = await documentOf(f.clientA);
    const row = await attach(doc);
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.document.delete({ where: { id: doc } }),
    );
    expect(await A().complianceDeadlineDocument.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it('a link joins two deadlines of one client, never one to itself', async () => {
    const d1 = await deadline();
    const d2 = await deadline();
    const other = await deadline({}, () => otherClientA);
    const link = (a: string, b: string) =>
      A().complianceDeadlineLink.create({
        data: { businessId: f.firmA, deadlineId: a, relatedDeadlineId: b },
      });
    expect(await failure(link(d1.id, d1.id))).toMatch(/check constraint/i);
    expect(await failure(link(d1.id, other.id))).toMatch(/same client/);
    await expect(link(d1.id, d2.id)).resolves.toBeTruthy();
  });
});

describe('calendar library', () => {
  it('has a source over https, a state code and one version number per year', async () => {
    for (const data of [
      { sourceUrl: 'http://www.irs.gov/' },
      { sourceUrl: 'irs.gov' },
      { state: 'Georgia' },
      { name: ' ' },
      { effectiveYear: 1999 },
      { version: 0 },
    ]) {
      expect(await failure(calendar(data))).toMatch(/check constraint/i);
    }
    const cal = await calendar({ state: 'GA', authority: 'GA SOS', jurisdiction: 'STATE' });
    expect(
      await failure(
        calendar({
          state: 'GA',
          authority: 'GA SOS',
          jurisdiction: 'STATE',
          effectiveYear: cal.effectiveYear,
        }),
      ),
    ).toMatch(/unique/i);
    await expect(
      calendar({
        state: 'GA',
        authority: 'GA SOS',
        jurisdiction: 'STATE',
        effectiveYear: cal.effectiveYear,
        version: 2,
      }),
    ).resolves.toBeTruthy();
  });

  it('goes DRAFT, VERIFIED, PUBLISHED and needs its times; nothing skips a step', async () => {
    const cal = await calendar();
    expect(await failure(setStatus(cal.id, 'VERIFIED'))).toMatch(/check constraint/i);
    expect(await failure(publish(cal.id))).toMatch(/cannot become/);
    await verify(cal.id);
    expect(await failure(setStatus(cal.id, 'PUBLISHED'))).toMatch(/check constraint/i);
    await expect(publish(cal.id)).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(await failure(setStatus(cal.id, 'DRAFT'))).toMatch(/cannot become/);
    expect(await failure(setStatus(cal.id, 'ARCHIVED'))).toMatch(/cannot become/);
  });

  it('only one version is published; the old one is superseded first, and can come back', async () => {
    const v1 = await calendar({ authority: 'IRS two' });
    await verify(v1.id);
    await publish(v1.id);
    const v2 = await calendar({
      authority: 'IRS two',
      effectiveYear: v1.effectiveYear,
      version: 2,
    });
    await verify(v2.id);
    expect(await failure(publish(v2.id))).toMatch(/unique/i);
    await setStatus(v1.id, 'SUPERSEDED');
    await publish(v2.id);
    // Rollback: supersede the new one, publish the old one again.
    await setStatus(v2.id, 'SUPERSEDED');
    await expect(publish(v1.id)).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(setStatus(v2.id, 'ARCHIVED')).resolves.toMatchObject({ status: 'ARCHIVED' });
  });

  it('a version that left DRAFT keeps its identity and source, but its verified date can refresh', async () => {
    const cal = await calendar();
    await expect(
      A().complianceCalendar.update({ where: { id: cal.id }, data: { name: 'Renamed' } }),
    ).resolves.toBeTruthy();
    await verify(cal.id);
    for (const data of [
      { name: 'Again' },
      { sourceUrl: 'https://other.gov/' },
      { effectiveYear: 2045 },
    ]) {
      expect(await failure(A().complianceCalendar.update({ where: { id: cal.id }, data }))).toMatch(
        /left DRAFT/,
      );
    }
    await expect(
      A().complianceCalendar.update({ where: { id: cal.id }, data: { verifiedAt: new Date() } }),
    ).resolves.toBeTruthy();
  });
});

describe('calendar entries', () => {
  it('a fixed date has its date, a formula its rule, an unknown date neither', async () => {
    const cal = await calendar();
    await expect(entry(cal.id)).resolves.toBeTruthy();
    await expect(
      entry(cal.id, { ruleKind: 'FORMULA', dueOn: null, rule: { monthsAfterYearEnd: 3, day: 15 } }),
    ).resolves.toBeTruthy();
    await expect(
      entry(cal.id, { ruleKind: 'NEEDS_VERIFICATION', dueOn: null }),
    ).resolves.toBeTruthy();
    for (const data of [
      { dueOn: null },
      { rule: { x: 1 } },
      { ruleKind: 'FORMULA', dueOn: null },
      { ruleKind: 'FORMULA', rule: { x: 1 } },
      { ruleKind: 'FORMULA', dueOn: null, rule: [1] },
      { ruleKind: 'NEEDS_VERIFICATION' },
      { name: ' ' },
    ]) {
      expect(await failure(entry(cal.id, data))).toMatch(/check constraint/i);
    }
  });

  it('change only while the calendar is a DRAFT', async () => {
    const cal = await calendar();
    const e = await entry(cal.id);
    await expect(
      A().complianceCalendarEntry.update({ where: { id: e.id }, data: { form: 'Form 1040' } }),
    ).resolves.toBeTruthy();
    await verify(cal.id);
    expect(await failure(entry(cal.id))).toMatch(/only a DRAFT/);
    expect(
      await failure(
        A().complianceCalendarEntry.update({ where: { id: e.id }, data: { form: 'x' } }),
      ),
    ).toMatch(/only a DRAFT/);
    expect(await failure(A().complianceCalendarEntry.delete({ where: { id: e.id } }))).toMatch(
      /only a DRAFT/,
    );
  });

  it('a deadline records its entry once per client and statutory date', async () => {
    const cal = await calendar();
    const e = await entry(cal.id);
    const make = (statutoryDueOn: string, clientId = f.clientA) =>
      deadline(
        {
          calendarEntryId: e.id,
          statutoryDueOn: day(statutoryDueOn),
          dueOn: day(statutoryDueOn),
          applicabilityReason: 'Individual with estimated tax: IRS calendar, version 1',
        },
        () => clientId,
      );
    await make('2031-04-15');
    expect(await failure(make('2031-04-15'))).toMatch(/unique/i);
    await expect(make('2031-04-15', otherClientA)).resolves.toBeTruthy();
    await expect(make('2032-04-15')).resolves.toBeTruthy();
    expect(await failure(deadline({ applicabilityReason: 'x'.repeat(501) }))).toMatch(
      /check constraint/i,
    );
  });
});
