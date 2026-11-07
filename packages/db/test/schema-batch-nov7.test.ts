// The Nov 7 schema batch (R1; migration r1_schema_batch_nov7): the client timeline (MSG-F16,
// insert-only, one entry per source), a lead's follow-ups (L8), an appointment type's intake form
// and an intake's appointment (A9), the payment processors (PAY-3), a staff draft's files (SM12),
// the security admin flag and the MFA requirement with its documented exception (SEC-6), and a
// report's legend switch (RP-F18). Each table refuses another firm. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const ids = { lead: '', leadB: '', template: '', templateB: '', form: '', appointment: '' };
const ids2 = { draft: '', draftB: '', appointmentB: '' };

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1snb');
  const setup = async (businessId: string, clientId: string, staffId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID().slice(0, 6)}` },
      });
      const lead = await tx.lead.create({
        data: {
          businessId,
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `l-${randomUUID()}@snb.test`,
          nextActionType: 'CALL',
          nextActionAt: new Date('2026-12-01T15:00:00Z'),
          nextActionNote: 'Call back (fake)',
        },
      });
      const template = await tx.intakeTemplate.create({
        data: { businessId, serviceId: service.id },
      });
      const form = await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: service.id,
          templateId: template.id,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      const startsAt = new Date(
        Date.UTC(2033, 0, 3, 15) + Math.floor(Math.random() * 1000) * 7_200_000,
      );
      const appointment = await tx.appointment.create({
        data: {
          businessId,
          staffUserId: staffId,
          clientId,
          locationKind: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
        },
      });
      const draft = await tx.staffDraft.create({
        data: {
          businessId,
          createdById: (
            await tx.membership.findFirstOrThrow({ where: { businessId, userId: staffId } })
          ).id,
          step: 1,
          data: {} as never,
        },
      });
      return {
        lead: lead.id,
        template: template.id,
        form: form.id,
        appointment: appointment.id,
        draft: draft.id,
      };
    });
  const a = await setup(f.firmA, f.clientA, f.memberA);
  const b = await setup(f.firmB, f.clientB, f.memberB);
  Object.assign(ids, {
    lead: a.lead,
    template: a.template,
    form: a.form,
    appointment: a.appointment,
  });
  ids.leadB = b.lead;
  ids.templateB = b.template;
  ids2.draft = a.draft;
  ids2.draftB = b.draft;
  ids2.appointmentB = b.appointment;
});

describe('client timeline (MSG-F16)', () => {
  const entry = (data: Record<string, unknown> = {}) =>
    A().clientTimelineEntry.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        kind: 'EMAIL',
        sourceType: 'outbound_message',
        sourceId: randomUUID(),
        title: 'Email sent (fake)',
        summary: 'Asked for the W-2.',
        occurredAt: new Date(),
        createdByUserId: f.memberA,
        ...data,
      },
    });

  it('takes one entry per source record, and a system entry without a source', async () => {
    const sourceId = randomUUID();
    await expect(entry({ sourceId })).resolves.toMatchObject({ sourceId });
    expect(await failure(entry({ sourceId }))).toMatch(/unique|one_per_source/i);
    await expect(entry({ sourceId: null, createdByUserId: null })).resolves.toMatchObject({
      sourceId: null,
    });
  });

  it('refuses a bad source code or an overlong text (23514), and never changes (42501)', async () => {
    for (const data of [{ sourceType: 'Outbound' }, { title: ' ' }, { summary: 'x'.repeat(501) }]) {
      expect(await failure(entry(data)), JSON.stringify(data)).toMatch(
        /client_timeline_entries_shape/,
      );
    }
    const e = await entry();
    expect(
      await failure(
        A().clientTimelineEntry.update({ where: { id: e.id }, data: { title: 'Changed' } }),
      ),
    ).toMatch(/permission denied/i);
    expect(await failure(A().clientTimelineEntry.delete({ where: { id: e.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe("a lead's follow-ups (L8)", () => {
  it("holds the backfilled follow-up's shape, and several rows per lead", async () => {
    const fu = await A().leadFollowUp.create({
      data: {
        businessId: f.firmA,
        leadId: ids.lead,
        actionType: 'EMAIL',
        dueAt: new Date('2026-12-05T15:00:00Z'),
        note: 'Send the checklist (fake)',
        createdByUserId: f.memberA,
      },
    });
    await expect(
      A().leadFollowUp.update({
        where: { id: fu.id },
        data: { doneAt: new Date(), outcome: 'Sent (fake)' },
      }),
    ).resolves.toMatchObject({ outcome: 'Sent (fake)' });
    expect(
      await failure(
        A().leadFollowUp.create({
          data: {
            businessId: f.firmA,
            leadId: ids.lead,
            actionType: 'CALL',
            dueAt: new Date(),
            outcome: 'x',
          },
        }),
      ),
    ).toMatch(/lead_follow_ups_shape/);
    expect(
      await failure(
        A().leadFollowUp.update({ where: { id: fu.id }, data: { leadId: randomUUID() } }),
      ),
    ).toMatch(/cannot change|foreign key/i);
    await expect(A().leadFollowUp.delete({ where: { id: fu.id } })).resolves.toMatchObject({
      id: fu.id,
    });
  });
});

describe("an appointment's intake (A9) and the processors (PAY-3)", () => {
  it("links the firm's own intake template and appointment, never another firm's", async () => {
    const type = await A().appointmentType.create({
      data: {
        businessId: f.firmA,
        name: `Type ${randomUUID().slice(0, 6)}`,
        durationMinutes: 30,
        requiredIntakeTemplateId: ids.template,
      },
    });
    expect(type.requiredIntakeTemplateId).toBe(ids.template);
    expect(
      await failure(
        A().appointmentType.update({
          where: { id: type.id },
          data: { requiredIntakeTemplateId: ids.templateB },
        }),
      ),
    ).toMatch(/foreign key/i);
    const intake = await A().intake.create({
      data: {
        businessId: f.firmA,
        formId: ids.form,
        leadId: ids.lead,
        appointmentId: ids.appointment,
      },
    });
    expect(intake.appointmentId).toBe(ids.appointment);
    expect(
      await failure(
        A().intake.update({ where: { id: intake.id }, data: { appointmentId: ids2.appointmentB } }),
      ),
    ).toMatch(/foreign key/i);
  });

  it('defaults both processors to Stripe', async () => {
    await expect(
      A().paymentSettings.upsert({
        where: { businessId: f.firmA },
        update: {},
        create: { businessId: f.firmA },
      }),
    ).resolves.toMatchObject({ defaultCardProcessor: 'STRIPE', achProcessor: 'STRIPE' });
  });
});

describe("a staff draft's files (SM12)", () => {
  const file = (draftId: string, data: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return A().staffDraftAttachment.create({
      data: {
        id,
        businessId: f.firmA,
        staffDraftId: draftId,
        s3Key: `tenant/${f.firmA}/staff-drafts/${draftId}/${id}`,
        fileName: 'license.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1200,
        documentType: 'Professional license',
        createdByUserId: f.memberA,
        ...data,
      },
    });
  };

  it("keeps a file under its own draft's folder, starts unscanned, and goes with the draft", async () => {
    await expect(file(ids2.draft)).resolves.toMatchObject({ scanStatus: 'PENDING' });
    for (const data of [
      { s3Key: `tenant/${f.firmA}/staff-drafts/${randomUUID()}/x` },
      { s3Key: `tenant/${f.firmB}/staff-drafts/${ids2.draft}/x` },
      { sizeBytes: 0 },
      { documentType: ' ' },
    ]) {
      expect(await failure(file(ids2.draft, data)), JSON.stringify(data)).toMatch(
        /staff_draft_attachments_shape/,
      );
    }
    await A().staffDraft.delete({ where: { id: ids2.draft } });
    expect(await A().staffDraftAttachment.count({ where: { staffDraftId: ids2.draft } })).toBe(0);
  });
});

describe('security admin and MFA (SEC-6), and the legend (RP-F18)', () => {
  it('starts with no security admin, and MFA off only with a documented exception', async () => {
    await expect(
      A().membership.findFirstOrThrow({
        where: { userId: f.memberA },
        select: { isSecurityAdmin: true },
      }),
    ).resolves.toEqual({ isSecurityAdmin: false });
    await A().staffSecurityDefaults.create({ data: { businessId: f.firmA } });
    const set = (data: Record<string, unknown>) =>
      A().staffSecurityDefaults.update({ where: { businessId: f.firmA }, data });
    expect(await failure(set({ mfaRequired: false }))).toMatch(/mfa_exception/);
    expect(
      await failure(set({ mfaRequired: false, mfaExceptionNote: 'Shared kiosk (fake)' })),
    ).toMatch(/mfa_exception/);
    await expect(
      set({
        mfaRequired: false,
        mfaExceptionNote: 'Shared kiosk (fake)',
        mfaExceptionApprovedByUserId: f.memberA,
        mfaExceptionAt: new Date(),
      }),
    ).resolves.toMatchObject({ mfaRequired: false });
  });

  it('shows the legend unless a report hides it', async () => {
    const report = await A().reportDefinition.create({
      data: {
        businessId: f.firmA,
        category: 'FINANCIAL',
        dataSource: 'invoices_payments',
        name: `Legend ${randomUUID().slice(0, 6)}`,
        columns: ['client_name'],
        datePreset: 'this_year',
        ownerUserId: f.memberA,
      },
    });
    expect(report.showLegend).toBe(true);
  });
});

describe('isolation', () => {
  it("another firm never sees or writes a firm's timeline, follow-ups or draft files", async () => {
    expect(await B().clientTimelineEntry.findMany({ where: { clientId: f.clientA } })).toEqual([]);
    expect(await B().leadFollowUp.findMany({ where: { leadId: ids.lead } })).toEqual([]);
    expect(
      await failure(
        B().clientTimelineEntry.create({
          data: {
            businessId: f.firmB,
            clientId: f.clientA,
            kind: 'NOTE',
            sourceType: 'note',
            title: 'Cross-firm (fake)',
            occurredAt: new Date(),
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        B().leadFollowUp.create({
          data: { businessId: f.firmB, leadId: ids.lead, actionType: 'CALL', dueAt: new Date() },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(
      await failure(
        B().staffDraftAttachment.create({
          data: {
            businessId: f.firmB,
            staffDraftId: ids2.draftB,
            s3Key: `tenant/${f.firmB}/staff-drafts/${ids2.draftB}/${randomUUID()}`,
            fileName: 'x.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1,
            documentType: 'Other',
            createdByUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});
