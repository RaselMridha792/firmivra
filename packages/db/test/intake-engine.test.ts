// r0_intake_engine: intake uploads in documents, the firm's request for changes, saved steps, a
// lead's tax year, draft expiry and 90-day cap, one Begin Online service per kind, client files
// and conversions only into ACTIVE engagements, meeting links and cancel cutoffs. As the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', client: '', tax: '', books: '', active: '', pending: '' };
const more = { taxForm: '', booksForm: '', staff: '', intakeB: '' };
const CHECK = /check constraint/i;
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const near = (at: Date | null, d = 0) =>
  Math.abs((at?.getTime() ?? 0) - days(d).getTime()) < 60_000;
const published = () => ({
  version: 1,
  title: 'Intake',
  status: 'PUBLISHED' as const,
  publishedAt: new Date(),
});

const firmA = () => db.forBusiness(ids.firmA);
const A = () => ({ businessId: ids.firmA });

/** A file for the client, by default a client upload into the ACTIVE tax engagement. */
type Upload = Partial<Record<'engagementId' | 'intakeId' | 'intakeSlot', string>> & {
  direction?: 'FIRM_TO_CLIENT';
  retentionUntil?: Date;
};
const upload = (data: Upload = {}) =>
  firmA().document.create({
    data: {
      ...A(),
      clientId: ids.client,
      engagementId: ids.active,
      direction: 'CLIENT_TO_FIRM',
      fileName: 'id.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      sha256: sha('file'),
      s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
      ...data,
    },
  });
const engagement = (serviceId: string, status: 'ACTIVE' | 'PENDING' | 'COMPLETED' = 'ACTIVE') =>
  firmA().engagement.create({
    data: {
      ...A(),
      clientId: ids.client,
      serviceId,
      title: status,
      status,
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  });
const newIntake = (engagementId = ids.active) =>
  firmA().intake.create({ data: { ...A(), formId: more.taxForm, engagementId } });
const setEngagement = (id: string, status: 'ACTIVE' | 'PENDING') =>
  firmA().engagement.update({ where: { id }, data: { status } });
const setIntake = (
  id: string,
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'UNDER_REVIEW' | 'COMPLETED',
) => firmA().intake.update({ where: { id }, data: { status } });
const newLead = (data: { taxYear?: number; createdAt?: Date; draftExpiresAt?: Date } = {}) =>
  firmA().lead.create({
    data: {
      ...A(),
      serviceId: ids.books,
      firstName: 'Lena',
      lastName: 'Lead',
      email: `lead-${randomUUID()}@begin.test`,
      ...data,
    },
  });
const submit = (id: string) =>
  firmA().lead.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });

beforeAll(async () => {
  const user = randomUUID();
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: { id: user, cognitoSub: user, pool: 'STAFF', email: `${user}@s.test`, name: 'Fake' },
    });
    ids.firmA = (await tx.business.create({ data: { slug: `ea-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `eb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const a = A();
    more.staff = (
      await tx.membership.create({ data: { ...a, userId: user, role: 'STAFF', status: 'ACTIVE' } })
    ).id;
    ids.client = (await tx.client.create({ data: { ...a, displayName: 'One' } })).id;
    ids.tax = (await tx.service.create({ data: { ...a, kind: 'ANNUAL_TAX', name: 'Tax' } })).id;
    ids.books = (
      await tx.service.create({ data: { ...a, kind: 'BOOKKEEPING', name: 'Books' } })
    ).id;
    const e = (status: 'ACTIVE' | 'PENDING') =>
      tx.engagement.create({
        data: { ...a, clientId: ids.client, serviceId: ids.tax, title: status, status },
      });
    ids.active = (await e('ACTIVE')).id;
    ids.pending = (await e('PENDING')).id;
    more.taxForm = (
      await tx.intakeForm.create({ data: { ...a, serviceId: ids.tax, ...published() } })
    ).id;
    more.booksForm = (
      await tx.intakeForm.create({ data: { ...a, serviceId: ids.books, ...published() } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const b = { businessId: ids.firmB };
    const client = await tx.client.create({ data: { ...b, displayName: 'B' } });
    const service = await tx.service.create({
      data: { ...b, kind: 'ANNUAL_TAX', name: 'Tax', beginOnline: true },
    });
    const e = await tx.engagement.create({
      data: { ...b, clientId: client.id, serviceId: service.id, title: 'B' },
    });
    const form = await tx.intakeForm.create({
      data: { ...b, serviceId: service.id, ...published() },
    });
    more.intakeB = (
      await tx.intake.create({ data: { ...b, formId: form.id, engagementId: e.id } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('meeting links and cancel cutoffs', () => {
  it('a meeting link is https, with no whitespace, control or invisible characters, up to 500', async () => {
    const set = (meetingUrl: string | null) =>
      firmA().membership.update({ where: { id: more.staff }, data: { meetingUrl } });
    const inside = (c: string) => `https://zoom.us/j/000${c}0000001`;
    for (const bad of [
      'http://zoom.us/j/0000000001',
      'javascript:alert(1)',
      'HTTPS://zoom.us/j/0000000001',
      'https://',
      ...[...' \t\n\u00a0\u200b\u00ad\u2800\u3164\ufe0f\u{e0069}'].map(inside),
      `https://${'a'.repeat(493)}`,
      // A user name (who the link claims to be), quotes, angle brackets, a backslash, a backtick.
      'https://zoom.us@evil.example/j/1',
      ...['"', "'", '<', '>', '\\', '`', '\u{e0100}'].map(inside),
    ]) {
      await expect(set(bad)).rejects.toThrow(CHECK);
    }
    for (const good of [null, 'https://zoom.us/j/0000000001', `https://${'a'.repeat(492)}`]) {
      await expect(set(good)).resolves.toMatchObject({ meetingUrl: good });
    }
  });

  it('a cancel cutoff is 0 to 720 hours, 24 by default', async () => {
    const type = (cancelCutoffHours?: number) =>
      firmA().appointmentType.create({
        data: { ...A(), name: `Type ${randomUUID()}`, durationMinutes: 30, cancelCutoffHours },
      });
    await expect(type()).resolves.toMatchObject({ cancelCutoffHours: 24 });
    for (const bad of [-1, 721]) await expect(type(bad)).rejects.toThrow(CHECK);
    for (const good of [0, 720])
      await expect(type(good)).resolves.toMatchObject({ cancelCutoffHours: good });
  });
});

describe('services.begin_online', () => {
  it('one live Begin Online service per kind in a firm, never OTHER', async () => {
    const service = (kind: 'PAYROLL' | 'OTHER' | 'ANNUAL_TAX', beginOnline = true) =>
      firmA().service.create({ data: { ...A(), kind, name: `S ${randomUUID()}`, beginOnline } });
    const first = await service('PAYROLL');
    await expect(service('PAYROLL')).rejects.toThrow(/unique constraint/i);
    await expect(service('PAYROLL', false)).resolves.toMatchObject({ beginOnline: false });
    // An archived one doesn't count, until it comes back.
    const archive = (archivedAt: Date | null) =>
      firmA().service.update({ where: { id: first.id }, data: { archivedAt } });
    await archive(new Date());
    await expect(service('PAYROLL')).resolves.toMatchObject({ beginOnline: true });
    await expect(archive(null)).rejects.toThrow(/unique constraint/i);
    await expect(service('OTHER')).rejects.toThrow(CHECK);
    // Firm B's Annual Tax on Begin Online doesn't count here.
    await expect(service('ANNUAL_TAX')).resolves.toMatchObject({ beginOnline: true });
  });
});

describe('leads: tax year, draft expiry and the 90-day cap', () => {
  it('created_at is the database clock; a draft runs at most 30 days from its last activity', async () => {
    const lead = await newLead({ createdAt: days(-200) });
    expect([near(lead.createdAt), near(lead.draftExpiresAt, 30)]).toEqual([true, true]);
    expect(near((await newLead({ draftExpiresAt: days(10) })).draftExpiresAt, 10)).toBe(true);
    await expect(newLead({ draftExpiresAt: days(31) })).rejects.toThrow(/at most 30 days/);
    const renew = (draftExpiresAt: Date | null) =>
      firmA().lead.update({ where: { id: lead.id }, data: { draftExpiresAt } });
    await expect(renew(null)).rejects.toThrow(CHECK);
    await expect(renew(days(31))).rejects.toThrow(/at most 30 days from its last activity/);
    await expect(renew(days(29))).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('neither the draft nor its resume link outlives created_at + 90 days', async () => {
    const lead = await newLead();
    // Started 70 days ago: created_at is the database's, so step around the trigger.
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.lead.update({
        where: { id: lead.id },
        data: { createdAt: days(-70), draftExpiresAt: days(10) },
      });
    });
    const renew = (d: number) =>
      firmA().lead.update({ where: { id: lead.id }, data: { draftExpiresAt: days(d) } });
    const link = (d: number) =>
      firmA().lead.update({
        where: { id: lead.id },
        data: { resumeTokenHash: sha(randomUUID()), resumeExpiresAt: days(d) },
      });
    await expect(renew(25)).rejects.toThrow(CHECK);
    await expect(link(25)).rejects.toThrow(CHECK);
    await expect(renew(19)).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(link(19)).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('an expired draft only becomes EXPIRED; no lead goes back to DRAFT; a sent lead keeps its expiry', async () => {
    const [expired, sent] = [(await newLead()).id, (await newLead()).id];
    const set = (id: string, data: Prisma.LeadUncheckedUpdateInput) =>
      firmA().lead.update({ where: { id }, data });
    await set(expired, { draftExpiresAt: days(-1) });
    const send = { status: 'SUBMITTED', submittedAt: new Date() } as const;
    const books = (await engagement(ids.books)).id;
    for (const data of [
      { draftExpiresAt: days(29) },
      send,
      { ...send, status: 'IN_REVIEW' },
      { ...send, status: 'CONVERTED', clientId: ids.client, engagementId: books },
    ] as const) {
      await expect(set(expired, data)).rejects.toThrow(/draft expired/);
    }
    await expect(set(expired, { status: 'EXPIRED' })).resolves.toMatchObject({ status: 'EXPIRED' });
    // EXPIRED is final.
    for (const data of [send, { ...send, status: 'IN_REVIEW' }] as const)
      await expect(set(expired, data)).rejects.toThrow(/stays EXPIRED/);
    await expect(set(expired, { status: 'DRAFT' })).rejects.toThrow(/never goes back/);
    // Not moved or cleared by the update that sends the lead, nor afterwards.
    for (const draftExpiresAt of [days(5), null])
      await expect(set(sent, { ...send, draftExpiresAt })).rejects.toThrow(/only a draft's/);
    await set(sent, send);
    for (const draftExpiresAt of [days(5), null])
      await expect(set(sent, { draftExpiresAt })).rejects.toThrow(/only a draft's/);
  });

  it('an expired draft takes no new upload, answers or resume link; clearing them stays possible', async () => {
    const lead = await newLead();
    const intake = await firmA().intake.create({
      data: { ...A(), formId: more.booksForm, leadId: lead.id },
    });
    const sub = await firmA().intakeSubmission.create({
      data: {
        ...A(),
        intakeId: intake.id,
        version: 1,
        answers: { fullName: 'Lena' },
        savedSteps: ['about'],
      },
    });
    const file = (n: string) => ({
      ...A(),
      leadId: lead.id,
      slot: 'priorReturn',
      fileName: `${n}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      sha256: sha(n),
      s3Key: `tenant/${ids.firmA}/leads/${randomUUID()}`,
    });
    await firmA().leadUpload.create({ data: file('before') });
    await firmA().lead.update({ where: { id: lead.id }, data: { draftExpiresAt: days(-1) } });
    await expect(firmA().leadUpload.create({ data: file('after') })).rejects.toThrow(
      /unexpired draft/,
    );
    const save = (data: Prisma.IntakeSubmissionUncheckedUpdateInput) =>
      firmA().intakeSubmission.update({ where: { id: sub.id }, data });
    await expect(save({ answers: { fullName: 'Changed' } })).rejects.toThrow(/only clear/);
    await expect(save({ savedSteps: ['about', 'documents'] })).rejects.toThrow(/only clear/);
    await expect(save({ answers: {}, savedSteps: [] })).resolves.toMatchObject({ savedSteps: [] });
    const relink = { resumeTokenHash: sha(randomUUID()), resumeExpiresAt: days(20) };
    await expect(firmA().lead.update({ where: { id: lead.id }, data: relink })).rejects.toThrow(
      /no new resume link/,
    );
    await expect(
      firmA().lead.update({
        where: { id: lead.id },
        data: { resumeTokenHash: null, resumeExpiresAt: null },
      }),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(
      firmA().lead.update({ where: { id: lead.id }, data: { status: 'EXPIRED' } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
  });

  it('the tax year is 2000 to 2100, set once while a draft', async () => {
    for (const taxYear of [1999, 2101]) await expect(newLead({ taxYear })).rejects.toThrow(CHECK);
    const setYear = (id: string, taxYear: number | null) =>
      firmA().lead.update({ where: { id }, data: { taxYear } });
    const fixed = await newLead({ taxYear: 2025 });
    for (const taxYear of [2026, null])
      await expect(setYear(fixed.id, taxYear)).rejects.toThrow(/set once/);
    await expect(setYear(fixed.id, 2025)).resolves.toMatchObject({ taxYear: 2025 });
    await expect(setYear((await newLead()).id, 2025)).resolves.toMatchObject({ taxYear: 2025 });
    const sent = await newLead();
    await submit(sent.id);
    await expect(setYear(sent.id, 2025)).rejects.toThrow(/set once/);
  });
});

describe('converting a lead', () => {
  it('only into an ACTIVE engagement; its files then carry over into the intake', async () => {
    const lead = await newLead({ taxYear: 2025 });
    const file = await firmA().leadUpload.create({
      data: {
        ...A(),
        leadId: lead.id,
        slot: 'priorReturn',
        fileName: 'return.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        sha256: sha('return'),
        s3Key: `tenant/${ids.firmA}/leads/${randomUUID()}`,
      },
    });
    const scan = { scanStatus: 'CLEAN' as const, scannedAt: new Date() };
    await firmA().leadUpload.update({ where: { id: file.id }, data: scan });
    const intake = await firmA().intake.create({
      data: { ...A(), formId: more.booksForm, leadId: lead.id },
    });
    await submit(lead.id);
    await setIntake(intake.id, 'SUBMITTED');
    const convert = (engagementId: string) =>
      firmA().lead.update({
        where: { id: lead.id },
        data: { status: 'CONVERTED', clientId: ids.client, engagementId },
      });
    for (const status of ['PENDING', 'COMPLETED'] as const) {
      await expect(convert((await engagement(ids.books, status)).id)).rejects.toThrow(
        /only into an ACTIVE/,
      );
    }
    const e = await engagement(ids.books);
    await convert(e.id);
    await firmA().intake.update({ where: { id: intake.id }, data: { engagementId: e.id } });
    const { fileName, contentType, sizeBytes, sha256, s3Key } = file;
    const carry = (intakeSlot: string) =>
      firmA().document.create({
        data: {
          ...{ ...A(), ...scan, fileName, contentType, sizeBytes, sha256, s3Key, intakeSlot },
          ...{
            clientId: ids.client,
            engagementId: e.id,
            leadUploadId: file.id,
            intakeId: intake.id,
          },
          direction: 'CLIENT_TO_FIRM',
        },
      });
    // Into an ACTIVE engagement only; it keeps its upload's slot; the intake (SUBMITTED) need not
    // be open, but the file then stays in it.
    await setEngagement(e.id, 'PENDING');
    await expect(carry('priorReturn')).rejects.toThrow(/open engagement/);
    await setEngagement(e.id, 'ACTIVE');
    await expect(carry('governmentId')).rejects.toThrow(/intake upload/);
    const doc = await carry('priorReturn');
    expect(doc).toMatchObject({ intakeSlot: 'priorReturn', scanStatus: 'CLEAN' });
    await expect(firmA().document.delete({ where: { id: doc.id } })).rejects.toThrow(
      /only leaves its intake/,
    );
  });
});

describe('documents', () => {
  it('a PENDING engagement takes no client upload, and its client uploads are not deleted', async () => {
    await expect(upload({ engagementId: ids.pending })).rejects.toThrow(/open engagement/);
    await expect(
      upload({ engagementId: ids.pending, direction: 'FIRM_TO_CLIENT' }),
    ).resolves.toBeTruthy();
    const e = await engagement(ids.tax);
    const doc = await upload({ engagementId: e.id });
    const remove = async () => (await firmA().document.deleteMany({ where: { id: doc.id } })).count;
    await setEngagement(e.id, 'PENDING');
    expect(await remove()).toBe(0);
    await setEngagement(e.id, 'ACTIVE');
    expect(await remove()).toBe(1);
  });

  it('an intake upload: a client file in a slot (a form key) of an open intake of its engagement', async () => {
    const intake = await newIntake();
    const into = (intakeSlot = 'governmentId', intakeId = intake.id) =>
      upload({ intakeId, intakeSlot });
    await expect(into()).resolves.toMatchObject({
      intakeId: intake.id,
      intakeSlot: 'governmentId',
    });
    await expect(upload({ intakeId: intake.id })).rejects.toThrow(CHECK);
    await expect(upload({ intakeSlot: 'governmentId' })).rejects.toThrow(CHECK);
    for (const slot of ['', 'Gov', 'gov id', 'résumé', 'constructor', 'a'.repeat(65)]) {
      await expect(into(slot)).rejects.toThrow(CHECK);
    }
    const NOT = /intake upload/;
    await expect(
      upload({ intakeId: intake.id, intakeSlot: 'x', direction: 'FIRM_TO_CLIENT' }),
    ).rejects.toThrow(NOT);
    // Never another engagement's intake, a lead's intake (no engagement yet) or another firm's.
    const other = await newIntake((await engagement(ids.tax)).id);
    const ofLead = await firmA().intake.create({
      data: { ...A(), formId: more.booksForm, leadId: (await newLead()).id },
    });
    for (const id of [other.id, ofLead.id, more.intakeB])
      await expect(into('x', id)).rejects.toThrow(NOT);
    // Only while the intake is open: SENT, IN_PROGRESS or NEEDS_CORRECTION.
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'] as const) {
      await setIntake(intake.id, status);
      await expect(into()).rejects.toThrow(NOT);
    }
    await firmA().intake.update({
      where: { id: intake.id },
      data: { status: 'NEEDS_CORRECTION', correctionNote: 'Please add your 1099-INT.' },
    });
    await expect(into()).resolves.toMatchObject({ intakeSlot: 'governmentId' });
  });

  it('a file only leaves its intake (detached or deleted) while it is open, or past retention', async () => {
    const intake = await newIntake();
    const slot = { intakeId: intake.id, intakeSlot: 'governmentId' };
    const [doc, other, kept] = [
      await upload(slot),
      await upload(slot),
      await upload({ ...slot, retentionUntil: days(-3) }),
    ];
    const plain = await upload();
    const remove = async (id: string) =>
      (await firmA().document.deleteMany({ where: { id } })).count;
    const update = (id: string, data: { intakeId?: string | null; intakeSlot?: string | null }) =>
      firmA().document.update({ where: { id }, data });
    const LEAVES = /only leaves its intake/;
    await expect(update(plain.id, slot)).rejects.toThrow(LEAVES);
    await expect(update(doc.id, { intakeSlot: 'spouseGovernmentId' })).rejects.toThrow(LEAVES);
    await expect(update(doc.id, { intakeSlot: null })).rejects.toThrow(LEAVES);
    const detach = () => update(doc.id, { intakeId: null, intakeSlot: null });
    await setIntake(intake.id, 'SUBMITTED');
    await expect(detach()).rejects.toThrow(LEAVES);
    await expect(remove(doc.id)).rejects.toThrow(LEAVES);
    expect(await remove(kept.id)).toBe(1);
    await setIntake(intake.id, 'IN_PROGRESS');
    await expect(detach()).resolves.toMatchObject({ intakeId: null, intakeSlot: null });
    expect(await remove(other.id)).toBe(1);
  });
});

describe('intakes and their versions', () => {
  it('a correction note exactly while NEEDS_CORRECTION, timed by the database clock', async () => {
    const intake = await newIntake();
    type Data = {
      status?: 'NEEDS_CORRECTION' | 'SUBMITTED';
      correctionNote?: string | null;
      correctionRequestedAt?: Date | null;
    };
    const set = (data: Data) => firmA().intake.update({ where: { id: intake.id }, data });
    await expect(set({ status: 'NEEDS_CORRECTION' })).rejects.toThrow(CHECK);
    await expect(set({ correctionNote: 'Add your W-2.' })).rejects.toThrow(CHECK);
    const asked = await set({
      status: 'NEEDS_CORRECTION',
      correctionNote: 'Add your W-2.',
      correctionRequestedAt: days(-3),
    });
    expect(near(asked.correctionRequestedAt)).toBe(true);
    for (const correctionRequestedAt of [days(-3), null]) {
      await expect(set({ correctionRequestedAt })).resolves.toMatchObject({
        correctionRequestedAt: asked.correctionRequestedAt,
      });
    }
    // A changed note is a new request: stamped again.
    const again = await set({ correctionNote: 'Add your W-2 and 1099-INT.' });
    expect(Number(again.correctionRequestedAt)).toBeGreaterThan(
      Number(asked.correctionRequestedAt),
    );
    await expect(set({ status: 'SUBMITTED' })).rejects.toThrow(CHECK);
    await expect(set({ status: 'SUBMITTED', correctionNote: null })).resolves.toMatchObject({
      correctionRequestedAt: null,
    });
    // Up to 2,000 characters, not only blanks; line breaks, no other control, filler or invisible.
    const inside = [...'\u0007\u0085\u200b\u202e\u00ad\u2028\u3164\u{e0069}'].map((c) => `a${c}b`);
    for (const bad of [' \n\t', '\u00a0\u3000', '\u2800', 'x'.repeat(2001), ...inside]) {
      await expect(set({ status: 'NEEDS_CORRECTION', correctionNote: bad })).rejects.toThrow(CHECK);
    }
    for (const good of ['Line 1\r\n\tLine 2', '\u26a0\ufe0f Add your W-2.', 'x'.repeat(2000)]) {
      await expect(set({ status: 'NEEDS_CORRECTION', correctionNote: good })).resolves.toBeTruthy();
    }
  });

  it('saved steps: step keys, none twice, at most 10, never NULL', async () => {
    const draft = await firmA().intakeSubmission.create({
      data: { ...A(), intakeId: (await newIntake()).id, version: 1 },
    });
    expect(draft.savedSteps).toEqual([]);
    const save = (savedSteps: string[]) =>
      firmA().intakeSubmission.update({ where: { id: draft.id }, data: { savedSteps } });
    const steps = (n: number) => Array.from({ length: n }, (_, i) => `step${i}`);
    for (const bad of [['personal', 'personal'], ['Personal'], [''], ['constructor'], steps(11)]) {
      await expect(save(bad)).rejects.toThrow(CHECK);
    }
    const raw = (savedSteps: string | null) =>
      db.withScope(
        { kind: 'business', businessId: ids.firmA },
        (tx) =>
          tx.$executeRaw`UPDATE intake_submissions SET saved_steps = ${savedSteps}::text[] WHERE id = ${draft.id}::uuid`,
      );
    // No NULL step, one dimension (unnest would flatten {{a,b},{c,d}}), never a NULL list.
    for (const bad of ['{a,NULL}', '{{a,b},{c,d}}']) await expect(raw(bad)).rejects.toThrow(CHECK);
    await expect(raw(null)).rejects.toThrow(/not-null/i);
    await expect(save(steps(10))).resolves.toMatchObject({ savedSteps: steps(10) });
  });
});
