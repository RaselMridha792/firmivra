// R55's Review Two schema (migration r55_review_two, Rasel's approval, Nov 14): a lead's tasks,
// staff files on an open lead, date of birth and other phones and emails; an intake template's
// portal switch and hashed public link; the intake retention minimums and the final reminder no
// longer after the first; the regular documents' size limit; a firm file's client visibility;
// the appointment confirmation message, reminder notes and where instructions show. Each new
// table and link refuses another firm. Runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
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
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const ids = {
  lead: '',
  closedLead: '',
  leadB: '',
  template: '',
  engagement: '',
  login: '',
  firmFolder: '',
};

const sha = (c: string) => c.repeat(64);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r55rt');
  ids.engagement = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
  const loginUser = randomUUID();
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: loginUser,
        cognitoSub: loginUser,
        pool: 'CLIENT',
        email: `${loginUser}@r55rt.test`,
        name: 'Fake Login',
      },
    }),
  );
  const leadIn = async (businessId: string) =>
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
          email: `l-${randomUUID()}@r55rt.test`,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });
      const template = await tx.intakeTemplate.create({
        data: { businessId, serviceId: service.id },
      });
      return { lead: lead.id, template: template.id };
    });
  const a = await leadIn(f.firmA);
  ids.lead = a.lead;
  ids.template = a.template;
  // A lead staff can no longer add files to: archived.
  ids.closedLead = (await leadIn(f.firmA)).lead;
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.lead.update({
      where: { id: ids.closedLead },
      data: { archivedAt: new Date(), archivedByUserId: f.memberA },
    }),
  );
  ids.leadB = (await leadIn(f.firmB)).lead;
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    ids.login = (
      await tx.clientAccount.create({
        data: {
          businessId: f.firmA,
          userId: loginUser,
          clientId: f.clientA,
          email: `${loginUser}@r55rt.test`,
          status: 'ACTIVE',
        },
      })
    ).id;
    ids.firmFolder = (
      await tx.documentFolder.create({
        data: { businessId: f.firmA, name: `Firm only ${randomUUID().slice(0, 6)}`, scope: 'FIRM' },
      })
    ).id;
  });
});

describe('Leads (R2 2, 4, 8, 9)', () => {
  it("a task is a client's or a lead's, never both, and never another firm's lead", async () => {
    await expect(
      A().task.create({ data: { businessId: f.firmA, leadId: ids.lead, title: 'Call (fake)' } }),
    ).resolves.toMatchObject({ leadId: ids.lead, clientId: null });
    expect(
      await failure(
        A().task.create({
          data: { businessId: f.firmA, leadId: ids.lead, clientId: f.clientA, title: 'x' },
        }),
      ),
    ).toMatch(/tasks_client_or_lead/);
    expect(
      await failure(
        B().task.create({ data: { businessId: f.firmB, leadId: ids.lead, title: 'x' } }),
      ),
    ).toMatch(/foreign key/i);
  });

  it('keeps a date of birth from 1900 on', async () => {
    const dob = new Date('1988-04-02T00:00:00Z');
    await expect(
      A().lead.update({ where: { id: ids.lead }, data: { dateOfBirth: dob } }),
    ).resolves.toMatchObject({ dateOfBirth: dob });
    expect(
      await failure(
        A().lead.update({
          where: { id: ids.lead },
          data: { dateOfBirth: new Date('1899-12-31T00:00:00Z') },
        }),
      ),
    ).toMatch(/leads_date_of_birth/);
  });

  it("keeps a lead's other emails (lower case, once) and phones, on its own lead", async () => {
    const point = (data: Record<string, unknown>) =>
      A().leadContactPoint.create({
        data: { businessId: f.firmA, leadId: ids.lead, position: 0, ...data } as never,
      });
    const email = `work-${randomUUID().slice(0, 6)}@r55rt.test`;
    const saved = await point({ kind: 'EMAIL', value: email, label: 'Work' });
    expect(await failure(point({ kind: 'EMAIL', value: email.toUpperCase() }))).toMatch(
      /lead_contact_points_shape/,
    );
    expect(await failure(point({ kind: 'EMAIL', value: email }))).toMatch(/unique|once/i);
    await expect(
      point({ kind: 'PHONE', value: '(555) 010-0199', position: 1 }),
    ).resolves.toBeTruthy();
    expect(await failure(point({ kind: 'PHONE', value: '   ' }))).toMatch(
      /lead_contact_points_shape/,
    );
    expect(
      await failure(point({ kind: 'PHONE', value: '555-0100', label: 'x'.repeat(41) })),
    ).toMatch(/lead_contact_points_shape/);
    expect(
      await failure(
        A().leadContactPoint.update({ where: { id: saved.id }, data: { leadId: ids.closedLead } }),
      ),
    ).toMatch(/cannot change/);
    // Another firm sees none of them and adds none to this lead.
    expect(await B().leadContactPoint.findMany({ where: { leadId: ids.lead } })).toEqual([]);
    expect(
      await failure(
        B().leadContactPoint.create({
          data: { businessId: f.firmB, leadId: ids.lead, kind: 'PHONE', value: '555', position: 0 },
        }),
      ),
    ).toMatch(/foreign key/i);
  });

  it('takes a staff file on an open lead only, in the staff slot; the lead keeps its draft rule', async () => {
    const upload = (leadId: string, data: Record<string, unknown> = {}) =>
      A().leadUpload.create({
        data: {
          businessId: f.firmA,
          leadId,
          slot: 'staff',
          fileName: 'Notes.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: sha('b'),
          s3Key: `tenant/${f.firmA}/leads/${leadId}/${randomUUID()}`,
          uploadedByUserId: f.memberA,
          ...data,
        } as never,
      });
    const saved = await upload(ids.lead);
    expect(saved).toMatchObject({ uploadedByUserId: f.memberA, slot: 'staff' });
    expect(await failure(upload(ids.lead, { slot: 'w2' }))).toMatch(/lead_uploads_staff_slot/);
    expect(await failure(upload(ids.closedLead))).toMatch(/open lead only/);
    // The lead's own (Begin Online) file still needs the lead to be a draft.
    expect(await failure(upload(ids.lead, { uploadedByUserId: null, slot: 'w2' }))).toMatch(
      /only while the lead is a draft/,
    );
    expect(
      await failure(
        A().leadUpload.update({ where: { id: saved.id }, data: { uploadedByUserId: f.member2A } }),
      ),
    ).toMatch(/cannot change/);
    // Removed while the lead is open; another firm adds none to it.
    await expect(A().leadUpload.delete({ where: { id: saved.id } })).resolves.toBeTruthy();
    expect(
      await failure(
        B().leadUpload.create({
          data: {
            businessId: f.firmB,
            leadId: ids.lead,
            slot: 'staff',
            fileName: 'x.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1,
            sha256: sha('c'),
            s3Key: `tenant/${f.firmB}/leads/${randomUUID()}`,
            uploadedByUserId: f.memberB,
          },
        }),
      ),
    ).toMatch(/foreign key|open lead only/i);
  });
});

describe('Intake Forms (ACCESS-02, 14b, 10c)', () => {
  it('keeps the share token as a SHA-256, once, and never on an archived form', async () => {
    const t = await A().intakeTemplate.findUniqueOrThrow({ where: { id: ids.template } });
    expect(t.portalPublished).toBe(false);
    const token = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await expect(
      A().intakeTemplate.update({
        where: { id: ids.template },
        data: { shareTokenHash: token, portalPublished: true },
      }),
    ).resolves.toMatchObject({ portalPublished: true });
    expect(
      await failure(
        A().intakeTemplate.update({ where: { id: ids.template }, data: { shareTokenHash: 'abc' } }),
      ),
    ).toMatch(/intake_templates_share_token/);
    expect(
      await failure(
        A().intakeTemplate.update({
          where: { id: ids.template },
          data: { archivedAt: new Date() },
        }),
      ),
    ).toMatch(/intake_templates_share_token/);
  });

  it('takes 1 to 30 years per category, and a final reminder at or before the first', async () => {
    await A().intakeSettings.create({ data: { businessId: f.firmA } });
    await expect(
      A().intakeSettings.update({
        where: { businessId: f.firmA },
        data: { retentionYearsClientDocuments: 7, retentionYearsTaxReturnDocuments: 30 },
      }),
    ).resolves.toMatchObject({ retentionYearsClientDocuments: 7 });
    expect(
      await failure(
        A().intakeSettings.update({
          where: { businessId: f.firmA },
          data: { retentionYearsPortalMessages: 31 },
        }),
      ),
    ).toMatch(/intake_settings_retention_years/);
    // 10c: the final reminder counts back from the expiry now (5 minutes before it).
    await expect(
      A().intakeSettings.update({
        where: { businessId: f.firmA },
        data: { firstReminderMinutes: 4320, finalReminderMinutes: 5 },
      }),
    ).resolves.toMatchObject({ finalReminderMinutes: 5 });
    expect(
      await failure(
        A().intakeSettings.update({
          where: { businessId: f.firmA },
          data: { finalReminderMinutes: 4 },
        }),
      ),
    ).toMatch(/intake_settings_ranges/);
  });
});

describe('Documents (DOCUMENTS-LIMIT-01, C2-052)', () => {
  const file = (direction: 'INTERNAL' | 'FIRM_TO_CLIENT', data: Record<string, unknown> = {}) =>
    A().document.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        engagementId: ids.engagement,
        direction,
        fileName: 'File.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        sha256: sha('a'),
        s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
        ...data,
      } as never,
    });

  it('takes the size choices only', async () => {
    await A().documentSettings.create({ data: { businessId: f.firmA } });
    expect(
      (await A().documentSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }))
        .maxFileSizeMb,
    ).toBe(100);
    await expect(
      A().documentSettings.update({ where: { businessId: f.firmA }, data: { maxFileSizeMb: 20 } }),
    ).resolves.toMatchObject({ maxFileSizeMb: 20 });
    expect(
      await failure(
        A().documentSettings.update({
          where: { businessId: f.firmA },
          data: { maxFileSizeMb: 25 },
        }),
      ),
    ).toMatch(/document_settings_max_file_size_mb/);
  });

  it("changes a firm file's client visibility both ways, never a client's upload", async () => {
    const doc = await file('INTERNAL');
    await expect(
      A().document.update({ where: { id: doc.id }, data: { direction: 'FIRM_TO_CLIENT' } }),
    ).resolves.toMatchObject({ direction: 'FIRM_TO_CLIENT' });
    await expect(
      A().document.update({ where: { id: doc.id }, data: { direction: 'INTERNAL' } }),
    ).resolves.toMatchObject({ direction: 'INTERNAL' });
    const upload = await file('INTERNAL', { direction: 'CLIENT_TO_FIRM' });
    expect(
      await failure(
        A().document.update({ where: { id: upload.id }, data: { direction: 'INTERNAL' } }),
      ),
    ).toMatch(/direction cannot change, except a firm file's client visibility/);
  });

  it('keeps a shared file visible until its client share is revoked, and a firm folder internal', async () => {
    const doc = await file('FIRM_TO_CLIENT');
    const share = await A().documentShare.create({
      data: {
        businessId: f.firmA,
        documentId: doc.id,
        recipientKind: 'CLIENT',
        clientAccountId: ids.login,
        grantedByUserId: f.memberA,
      },
    });
    expect(
      await failure(
        A().document.update({ where: { id: doc.id }, data: { direction: 'INTERNAL' } }),
      ),
    ).toMatch(/revoke the client/);
    await A().documentShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date(), revokedByUserId: f.memberA },
    });
    await expect(
      A().document.update({ where: { id: doc.id }, data: { direction: 'INTERNAL' } }),
    ).resolves.toMatchObject({ direction: 'INTERNAL' });
    const filed = await file('INTERNAL', { folderId: ids.firmFolder });
    expect(
      await failure(
        A().document.update({ where: { id: filed.id }, data: { direction: 'FIRM_TO_CLIENT' } }),
      ),
    ).toMatch(/firm folder takes internal documents only/);
  });
});

describe('Appointments (B7, B9)', () => {
  it('keeps the confirmation message and reminder notes within limits; instructions show by email and portal', async () => {
    const startsAt = new Date(
      Date.UTC(2034, 2, 6, 15) + Math.floor(Math.random() * 1000) * 7_200_000,
    );
    const appointment = await A().appointment.create({
      data: {
        businessId: f.firmA,
        staffUserId: f.memberA,
        clientId: f.clientA,
        locationKind: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        confirmationMessage: 'We look forward to seeing you (fake).',
      },
    });
    expect(appointment).toMatchObject({
      instructionsInEmail: true,
      instructionsInPortal: true,
      instructionsInSms: false,
    });
    expect(
      await failure(
        A().appointment.update({
          where: { id: appointment.id },
          data: { confirmationMessage: '  ' },
        }),
      ),
    ).toMatch(/appointments_confirmation_message/);
    const reminder = (note: string | null) =>
      A().appointmentReminder.create({
        data: {
          businessId: f.firmA,
          appointmentId: appointment.id,
          channel: 'EMAIL',
          offsetMinutes: Math.floor(Math.random() * 40000),
          note,
        },
      });
    await expect(reminder('Bring your receipts (fake).')).resolves.toBeTruthy();
    await expect(reminder(null)).resolves.toBeTruthy();
    expect(await failure(reminder('x'.repeat(501)))).toMatch(/appointment_reminders_note/);
  });
});
