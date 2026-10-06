// Tenant isolation: data of firm A is never visible to firm B, even with no WHERE clause.
// Runs as the real app role (firmivra_app) against the test database.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const unscopedApp = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  ownerA: randomUUID(),
  clientA: randomUUID(),
  ownerB: randomUUID(),
  clientB: randomUUID(),
  admin: randomUUID(),
  membershipA: '',
  clientAccountA: '',
  grantA: '',
  legalDocA: '',
  taxStatusA: '',
  inviteA: '',
  clientRecordA: '',
  clientTaxStatusA: '',
  serviceA: '',
  engagementA: '',
  taskA: '',
  noteA: '',
  reportA: '',
  categoryA: '',
  requestA: '',
  documentA: '',
  formA: '',
  leadA: '',
  intakeA: '',
  leadUploadA: '',
  notificationA: '',
  preferenceA: '',
  appointmentA: '',
  threadA: '',
  messageA: '',
  invoiceA: '',
  paymentA: '',
};
const tokenHash = (firm: string) =>
  createHash('sha256').update(`invite-${run}-${firm}`).digest('hex');
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
/** A fake Stripe connected account id per firm (acct_ + letters and digits). */
const firmAccount = (firm: string) => `acct_${firm.replace(/-/g, '')}`;

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const users = [
      [ids.ownerA, 'STAFF', `owner-a-${run}@a.test`],
      [ids.clientA, 'CLIENT', `client-a-${run}@a.test`],
      [ids.ownerB, 'STAFF', `owner-b-${run}@b.test`],
      [ids.clientB, 'CLIENT', `client-b-${run}@b.test`],
      [ids.admin, 'ADMIN', `admin-${run}@firmivra.test`],
    ] as const;
    for (const [id, pool, email] of users) {
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name: 'Fake Person' } });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    ids.firmA = (await tx.business.create({ data: { slug: `firm-a-${run}`, name: 'Firm A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `firm-b-${run}`, name: 'Firm B' } })).id;
    await tx.firmApplication.create({
      data: {
        legalName: 'Applicant LLC',
        contactName: 'Fake',
        contactEmail: `apply-${run}@x.test`,
        data: {},
      },
    });
  });

  for (const [firm, ownerId, clientId] of [
    [ids.firmA, ids.ownerA, ids.clientA],
    [ids.firmB, ids.ownerB, ids.clientB],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId: firm }, async (tx) => {
      const m = await tx.membership.create({
        data: { businessId: firm, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: clientId } });
      const record = await tx.client.create({
        data: { businessId: firm, displayName: 'Fake Client', assignedUserId: ownerId },
      });
      await tx.clientProfile.create({
        data: { clientId: record.id, businessId: firm, firstName: 'Fake', ssnLast4: '0000' },
      });
      const c = await tx.clientAccount.create({
        data: {
          businessId: firm,
          userId: clientId,
          clientId: record.id,
          email: user.email,
          status: 'ACTIVE',
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: firm,
          actorUserId: ownerId,
          action: 'test.created',
          entityType: 'test',
        },
      });
      await tx.businessSettings.create({ data: { businessId: firm } });
      const doc = await tx.firmLegalDocument.create({
        data: {
          businessId: firm,
          kind: 'TERMS',
          version: 1,
          body: 'x',
          publishedByUserId: ownerId,
        },
      });
      await tx.legalAcceptance.create({
        data: { businessId: firm, clientAccountId: c.id, legalDocumentId: doc.id },
      });
      const t = await tx.taxStatus.create({ data: { businessId: firm, name: 'Filed' } });
      const cts = await tx.clientTaxStatus.create({
        data: { businessId: firm, clientId: record.id, taxYear: 2025, taxStatusId: t.id },
      });
      const svc = await tx.service.create({
        data: { businessId: firm, kind: 'ANNUAL_TAX', name: 'Annual Tax', stages: ['New'] },
      });
      const work = { businessId: firm, clientId: record.id };
      const eng = await tx.engagement.create({
        data: { ...work, serviceId: svc.id, title: '2025 Personal Tax', stage: 'New' },
      });
      const task = await tx.task.create({
        data: { ...work, engagementId: eng.id, title: 'Task' },
      });
      const note = await tx.note.create({
        data: { ...work, engagementId: eng.id, body: 'Note', authorUserId: ownerId },
      });
      const rep = await tx.engagementReport.create({
        data: { businessId: firm, engagementId: eng.id, kind: 'REPORT', title: 'Report' },
      });
      const cat = await tx.documentCategory.create({ data: { businessId: firm, name: 'ID' } });
      const req = await tx.documentRequest.create({
        data: { ...work, engagementId: eng.id, categoryId: cat.id, title: 'Photo ID' },
      });
      const vaultDoc = await tx.document.create({
        data: {
          ...work,
          engagementId: eng.id,
          categoryId: cat.id,
          requestId: req.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'id.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${firm}/documents/${randomUUID()}`,
        },
      });
      const form = await tx.intakeForm.create({
        data: {
          businessId: firm,
          serviceId: svc.id,
          version: 1,
          title: 'Annual Tax intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      const lead = await tx.lead.create({
        data: {
          businessId: firm,
          serviceId: svc.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `lead-${run}@x.test`,
        },
      });
      const intake = await tx.intake.create({
        data: { businessId: firm, formId: form.id, leadId: lead.id },
      });
      await tx.intakeSubmission.create({
        data: { businessId: firm, intakeId: intake.id, version: 1 },
      });
      const leadUpload = await tx.leadUpload.create({
        data: {
          businessId: firm,
          leadId: lead.id,
          slot: 'id',
          fileName: 'id.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${firm}/leads/${randomUUID()}`,
        },
      });
      const note2 = await tx.notification.create({
        data: {
          businessId: firm,
          recipientUserId: clientId,
          category: 'DOCUMENTS',
          type: 'document_request.created',
          entityType: 'document_request',
          entityId: req.id,
        },
      });
      await tx.notificationDelivery.create({
        data: { businessId: firm, notificationId: note2.id, channel: 'EMAIL' },
      });
      const pref = await tx.notificationPreference.create({
        data: { businessId: firm, userId: clientId, category: 'DOCUMENTS' },
      });
      const apptType = await tx.appointmentType.create({
        data: { businessId: firm, name: 'Consultation', durationMinutes: 30 },
      });
      await tx.workingHours.create({
        data: {
          businessId: firm,
          userId: ownerId,
          weekday: 1,
          startsAt: new Date('1970-01-01T09:00:00Z'),
          endsAt: new Date('1970-01-01T17:00:00Z'),
        },
      });
      await tx.blockedTime.create({
        data: {
          businessId: firm,
          userId: ownerId,
          startsAt: new Date('2026-12-24T00:00:00Z'),
          endsAt: new Date('2026-12-26T00:00:00Z'),
        },
      });
      const appt = await tx.appointment.create({
        data: {
          ...work,
          staffUserId: ownerId,
          typeId: apptType.id,
          startsAt: new Date('2026-11-02T15:00:00Z'),
          endsAt: new Date('2026-11-02T15:30:00Z'),
          locationKind: 'VIDEO',
        },
      });
      const thread = await tx.messageThread.create({
        data: { ...work, engagementId: eng.id, subject: 'Question' },
      });
      const msg = await tx.message.create({
        data: {
          businessId: firm,
          threadId: thread.id,
          senderUserId: clientId,
          direction: 'CLIENT_TO_FIRM',
          body: 'Hello',
        },
      });
      await tx.messageAttachment.create({
        data: { businessId: firm, messageId: msg.id, documentId: vaultDoc.id },
      });
      await tx.stripeAccount.create({
        data: { businessId: firm, accountId: firmAccount(firm), chargesEnabled: true },
      });
      const bill = await tx.invoice.create({
        data: { ...work, number: 'INV-1' },
      });
      await tx.invoiceLine.create({
        data: { businessId: firm, invoiceId: bill.id, description: 'Fee', unitAmountCents: 100 },
      });
      await tx.invoice.update({
        where: { id: bill.id },
        data: { status: 'OPEN', issuedAt: new Date() },
      });
      const pay = await tx.payment.create({
        data: {
          businessId: firm,
          invoiceId: bill.id,
          amountCents: 100,
          processorRef: `cs_${randomUUID()}`,
          accountId: firmAccount(firm),
        },
      });
      await tx.paymentEvent.create({
        data: {
          businessId: firm,
          processorEventId: `evt_${randomUUID()}`,
          accountId: firmAccount(firm),
          type: 'checkout.session.completed',
          paymentId: pay.id,
        },
      });
      await tx.contentItem.create({
        data: { businessId: firm, kind: 'TIP', title: 'Tip', body: 'Keep receipts' },
      });
      await tx.calculatorDefinition.create({
        data: { businessId: firm, key: 'tax_return', title: 'Tax', disclaimer: 'Estimate only' },
      });
      const inv = await tx.invite.create({
        data: {
          businessId: firm,
          membershipId: m.id,
          tokenHash: tokenHash(firm),
          expiresAt: inDays(7),
        },
      });
      if (firm === ids.firmA) {
        ids.membershipA = m.id;
        ids.clientAccountA = c.id;
        ids.legalDocA = doc.id;
        ids.taxStatusA = t.id;
        ids.inviteA = inv.id;
        ids.clientRecordA = record.id;
        ids.clientTaxStatusA = cts.id;
        ids.serviceA = svc.id;
        ids.engagementA = eng.id;
        ids.taskA = task.id;
        ids.noteA = note.id;
        ids.reportA = rep.id;
        ids.categoryA = cat.id;
        ids.requestA = req.id;
        ids.documentA = vaultDoc.id;
        ids.formA = form.id;
        ids.leadA = lead.id;
        ids.intakeA = intake.id;
        ids.leadUploadA = leadUpload.id;
        ids.notificationA = note2.id;
        ids.preferenceA = pref.id;
        ids.appointmentA = appt.id;
        ids.threadA = thread.id;
        ids.messageA = msg.id;
        ids.invoiceA = bill.id;
        ids.paymentA = pay.id;
      }
    });
  }

  // Support access starts as a request from the platform side (Super Admin).
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const firm of [ids.firmA, ids.firmB]) {
      const g = await tx.supportAccessGrant.create({
        data: { businessId: firm, adminUserId: ids.admin, reason: 'test' },
      });
      if (firm === ids.firmA) ids.grantA = g.id;
    }
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), unscopedApp.$disconnect(), db.disconnect()]);
});

describe('no scope set', () => {
  it('the app role sees no rows in any table', async () => {
    expect(await unscopedApp.business.findMany()).toEqual([]);
    expect(await unscopedApp.user.findMany()).toEqual([]);
    expect(await unscopedApp.membership.findMany()).toEqual([]);
    expect(await unscopedApp.clientAccount.findMany()).toEqual([]);
    expect(await unscopedApp.auditLog.findMany()).toEqual([]);
    expect(await unscopedApp.firmApplication.findMany()).toEqual([]);
    expect(await unscopedApp.businessSettings.findMany()).toEqual([]);
    expect(await unscopedApp.firmLegalDocument.findMany()).toEqual([]);
    expect(await unscopedApp.legalAcceptance.findMany()).toEqual([]);
    expect(await unscopedApp.taxStatus.findMany()).toEqual([]);
    expect(await unscopedApp.invite.findMany()).toEqual([]);
    expect(await unscopedApp.client.findMany()).toEqual([]);
    expect(await unscopedApp.clientProfile.findMany()).toEqual([]);
    expect(await unscopedApp.clientTaxStatus.findMany()).toEqual([]);
    expect(await unscopedApp.clientTaxStatusHistory.findMany()).toEqual([]);
    expect(await unscopedApp.service.findMany()).toEqual([]);
    expect(await unscopedApp.engagement.findMany()).toEqual([]);
    expect(await unscopedApp.engagementStatusHistory.findMany()).toEqual([]);
    expect(await unscopedApp.task.findMany()).toEqual([]);
    expect(await unscopedApp.note.findMany()).toEqual([]);
    expect(await unscopedApp.engagementReport.findMany()).toEqual([]);
    expect(await unscopedApp.documentCategory.findMany()).toEqual([]);
    expect(await unscopedApp.documentRequest.findMany()).toEqual([]);
    expect(await unscopedApp.document.findMany()).toEqual([]);
    expect(await unscopedApp.intakeForm.findMany()).toEqual([]);
    expect(await unscopedApp.intake.findMany()).toEqual([]);
    expect(await unscopedApp.intakeSubmission.findMany()).toEqual([]);
    expect(await unscopedApp.lead.findMany()).toEqual([]);
    expect(await unscopedApp.leadUpload.findMany()).toEqual([]);
    expect(await unscopedApp.notification.findMany()).toEqual([]);
    expect(await unscopedApp.notificationDelivery.findMany()).toEqual([]);
    expect(await unscopedApp.notificationPreference.findMany()).toEqual([]);
    expect(await unscopedApp.appointmentType.findMany()).toEqual([]);
    expect(await unscopedApp.workingHours.findMany()).toEqual([]);
    expect(await unscopedApp.blockedTime.findMany()).toEqual([]);
    expect(await unscopedApp.appointment.findMany()).toEqual([]);
    expect(await unscopedApp.messageThread.findMany()).toEqual([]);
    expect(await unscopedApp.message.findMany()).toEqual([]);
    expect(await unscopedApp.messageAttachment.findMany()).toEqual([]);
    expect(await unscopedApp.clientPrivateNote.findMany()).toEqual([]);
    expect(await unscopedApp.clientNoteReminder.findMany()).toEqual([]);
    expect(await unscopedApp.invoice.findMany()).toEqual([]);
    expect(await unscopedApp.invoiceLine.findMany()).toEqual([]);
    expect(await unscopedApp.payment.findMany()).toEqual([]);
    expect(await unscopedApp.paymentEvent.findMany()).toEqual([]);
    expect(await unscopedApp.contentItem.findMany()).toEqual([]);
    expect(await unscopedApp.calculatorDefinition.findMany()).toEqual([]);
  });
});

describe('business scope: firm B', () => {
  const b = () => db.forBusiness(ids.firmB);

  it('lists only its own rows with no WHERE clause', async () => {
    const businesses = await b().business.findMany();
    expect(businesses.map((x) => x.id)).toEqual([ids.firmB]);

    for (const rows of [
      await b().membership.findMany(),
      await b().clientAccount.findMany(),
      await b().supportAccessGrant.findMany(),
      await b().auditLog.findMany(),
      await b().businessSettings.findMany(),
      await b().firmLegalDocument.findMany(),
      await b().legalAcceptance.findMany(),
      await b().taxStatus.findMany(),
      await b().invite.findMany(),
      await b().client.findMany(),
      await b().clientProfile.findMany(),
      await b().clientTaxStatus.findMany(),
      await b().clientTaxStatusHistory.findMany(),
      await b().service.findMany(),
      await b().engagement.findMany(),
      await b().engagementStatusHistory.findMany(),
      await b().task.findMany(),
      await b().note.findMany(),
      await b().engagementReport.findMany(),
      await b().documentCategory.findMany(),
      await b().documentRequest.findMany(),
      await b().document.findMany(),
      await b().intakeForm.findMany(),
      await b().intake.findMany(),
      await b().intakeSubmission.findMany(),
      await b().lead.findMany(),
      await b().leadUpload.findMany(),
      await b().notification.findMany(),
      await b().notificationDelivery.findMany(),
      await b().notificationPreference.findMany(),
      await b().appointmentType.findMany(),
      await b().workingHours.findMany(),
      await b().blockedTime.findMany(),
      await b().appointment.findMany(),
      await b().messageThread.findMany(),
      await b().message.findMany(),
      await b().messageAttachment.findMany(),
      await b().invoice.findMany(),
      await b().invoiceLine.findMany(),
      await b().payment.findMany(),
      await b().paymentEvent.findMany(),
      await b().contentItem.findMany(),
      await b().calculatorDefinition.findMany(),
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.businessId === ids.firmB)).toBe(true);
    }

    const users = await b().user.findMany();
    expect(users.map((u) => u.id).sort()).toEqual([ids.ownerB, ids.clientB].sort());
  });

  it("cannot read firm A's rows by id", async () => {
    expect(await b().business.findUnique({ where: { id: ids.firmA } })).toBeNull();
    expect(await b().membership.findUnique({ where: { id: ids.membershipA } })).toBeNull();
    expect(await b().clientAccount.findUnique({ where: { id: ids.clientAccountA } })).toBeNull();
    expect(await b().supportAccessGrant.findUnique({ where: { id: ids.grantA } })).toBeNull();
    expect(await b().user.findUnique({ where: { id: ids.ownerA } })).toBeNull();
    expect(await b().user.findUnique({ where: { id: ids.clientA } })).toBeNull();
    expect(await b().businessSettings.findUnique({ where: { businessId: ids.firmA } })).toBeNull();
    expect(await b().firmLegalDocument.findUnique({ where: { id: ids.legalDocA } })).toBeNull();
    expect(await b().taxStatus.findUnique({ where: { id: ids.taxStatusA } })).toBeNull();
    expect(await b().invite.findUnique({ where: { id: ids.inviteA } })).toBeNull();
    expect(await b().invite.findUnique({ where: { tokenHash: tokenHash(ids.firmA) } })).toBeNull();
    expect(await b().client.findUnique({ where: { id: ids.clientRecordA } })).toBeNull();
    expect(
      await b().clientProfile.findUnique({ where: { clientId: ids.clientRecordA } }),
    ).toBeNull();
    expect(
      await b().clientTaxStatus.findUnique({ where: { id: ids.clientTaxStatusA } }),
    ).toBeNull();
    expect(await b().service.findUnique({ where: { id: ids.serviceA } })).toBeNull();
    expect(await b().engagement.findUnique({ where: { id: ids.engagementA } })).toBeNull();
    expect(await b().task.findUnique({ where: { id: ids.taskA } })).toBeNull();
    expect(await b().note.findUnique({ where: { id: ids.noteA } })).toBeNull();
    expect(await b().engagementReport.findUnique({ where: { id: ids.reportA } })).toBeNull();
    expect(await b().documentCategory.findUnique({ where: { id: ids.categoryA } })).toBeNull();
    expect(await b().documentRequest.findUnique({ where: { id: ids.requestA } })).toBeNull();
    expect(await b().document.findUnique({ where: { id: ids.documentA } })).toBeNull();
    expect((await b().document.deleteMany({ where: { id: ids.documentA } })).count).toBe(0);
    expect(await b().intakeForm.findUnique({ where: { id: ids.formA } })).toBeNull();
    expect(await b().lead.findUnique({ where: { id: ids.leadA } })).toBeNull();
    expect(await b().intake.findUnique({ where: { id: ids.intakeA } })).toBeNull();
    expect(await b().leadUpload.findUnique({ where: { id: ids.leadUploadA } })).toBeNull();
    expect(await b().intakeSubmission.findMany({ where: { intakeId: ids.intakeA } })).toEqual([]);
    expect((await b().leadUpload.deleteMany({ where: { id: ids.leadUploadA } })).count).toBe(0);
    expect(await b().notification.findUnique({ where: { id: ids.notificationA } })).toBeNull();
    expect(
      await b().notificationDelivery.findMany({ where: { notificationId: ids.notificationA } }),
    ).toEqual([]);
    expect(
      (
        await b().notification.updateMany({
          where: { id: ids.notificationA },
          data: { readAt: new Date() },
        })
      ).count,
    ).toBe(0);
    expect(
      (await b().notificationPreference.deleteMany({ where: { id: ids.preferenceA } })).count,
    ).toBe(0);
    expect(await b().appointment.findUnique({ where: { id: ids.appointmentA } })).toBeNull();
    expect(await b().messageThread.findUnique({ where: { id: ids.threadA } })).toBeNull();
    expect(await b().message.findUnique({ where: { id: ids.messageA } })).toBeNull();
    expect(await b().invoice.findUnique({ where: { id: ids.invoiceA } })).toBeNull();
    expect(await b().payment.findUnique({ where: { id: ids.paymentA } })).toBeNull();
    // Firm B cannot pay, or record a webhook event against, firm A's invoice or payment.
    await expect(
      b().payment.create({
        data: {
          businessId: ids.firmB,
          invoiceId: ids.invoiceA,
          amountCents: 100,
          processorRef: `cs_${randomUUID()}`,
          accountId: firmAccount(ids.firmB),
        },
      }),
    ).rejects.toThrow();
    await expect(
      b().paymentEvent.create({
        data: {
          businessId: ids.firmB,
          processorEventId: `evt_${randomUUID()}`,
          accountId: firmAccount(ids.firmB),
          type: 'charge.refunded',
          paymentId: ids.paymentA,
        },
      }),
    ).rejects.toThrow(/account that sent the event|foreign key/i);
    await expect(
      b().message.create({
        data: {
          businessId: ids.firmB,
          threadId: ids.threadA,
          senderUserId: ids.ownerB,
          direction: 'FIRM_TO_CLIENT',
          body: 'Planted',
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await b().appointment.updateMany({
          where: { id: ids.appointmentA },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        })
      ).count,
    ).toBe(0);
    expect(
      await b().engagementStatusHistory.findMany({ where: { engagementId: ids.engagementA } }),
    ).toEqual([]);
    expect((await b().note.deleteMany({ where: { id: ids.noteA } })).count).toBe(0);
    expect(
      (
        await b().client.updateMany({
          where: { id: ids.clientRecordA },
          data: { displayName: 'x' },
        })
      ).count,
    ).toBe(0);
  });

  it("cannot update or delete firm A's rows", async () => {
    expect(
      (await b().membership.updateMany({ data: { role: 'STAFF' }, where: { id: ids.membershipA } }))
        .count,
    ).toBe(0);
    expect((await b().membership.deleteMany({ where: { businessId: ids.firmA } })).count).toBe(0);
    expect((await b().clientAccount.deleteMany({ where: { id: ids.clientAccountA } })).count).toBe(
      0,
    );
    expect(
      (await b().business.updateMany({ data: { name: 'hacked' }, where: { id: ids.firmA } })).count,
    ).toBe(0);
    await expect(
      b().membership.update({ where: { id: ids.membershipA }, data: { role: 'STAFF' } }),
    ).rejects.toThrow();

    const stillThere = await db
      .forBusiness(ids.firmA)
      .membership.findUnique({ where: { id: ids.membershipA } });
    expect(stillThere?.role).toBe('OWNER');
  });

  it('cannot write rows into firm A', async () => {
    await expect(
      b().membership.create({ data: { businessId: ids.firmA, userId: ids.ownerB, role: 'ADMIN' } }),
    ).rejects.toThrow();
    await expect(
      b().auditLog.create({ data: { businessId: ids.firmA, action: 'x', entityType: 'x' } }),
    ).rejects.toThrow();
    await expect(
      b().taxStatus.create({ data: { businessId: ids.firmA, name: 'Planted' } }),
    ).rejects.toThrow();
    expect(
      (await b().taxStatus.updateMany({ where: { id: ids.taxStatusA }, data: { name: 'x' } }))
        .count,
    ).toBe(0);
  });

  it('sees no platform tables', async () => {
    expect(await b().firmApplication.findMany()).toEqual([]);
    expect(await b().platformAdmin.findMany()).toEqual([]);
  });
});

describe('user scope', () => {
  it("sees only the person's own memberships and firms", async () => {
    const u = db.forUser(ids.ownerA);
    const memberships = await u.membership.findMany();
    expect(memberships.map((m) => m.businessId)).toEqual([ids.firmA]);
    expect((await u.business.findMany()).map((x) => x.id)).toEqual([ids.firmA]);
    expect((await u.user.findMany()).map((x) => x.id)).toEqual([ids.ownerA]);
    expect(await u.clientAccount.findMany()).toEqual([]);
    expect(await u.auditLog.findMany()).toEqual([]);
    expect(await u.taxStatus.findMany()).toEqual([]);
    expect(await u.invite.findMany()).toEqual([]);
    expect(await u.client.findMany()).toEqual([]);
    expect(await u.engagement.findMany()).toEqual([]);
  });
});

describe('invite scope', () => {
  it('sees only the invite with that token hash, and nothing else', async () => {
    const i = db.forInvite(tokenHash(ids.firmA));
    expect((await i.invite.findMany()).map((x) => x.id)).toEqual([ids.inviteA]);
    expect(await i.business.findMany()).toEqual([]);
    expect(await i.membership.findMany()).toEqual([]);
    expect(await i.user.findMany()).toEqual([]);
    expect(await i.taxStatus.findMany()).toEqual([]);
    expect(await i.businessSettings.findMany()).toEqual([]);
  });

  it('cannot change the invite it sees', async () => {
    const i = db.forInvite(tokenHash(ids.firmA));
    expect(
      (await i.invite.updateMany({ where: { id: ids.inviteA }, data: { acceptedAt: new Date() } }))
        .count,
    ).toBe(0);
  });

  it('sees nothing with an unknown hash, and rejects a malformed one', async () => {
    expect(await db.forInvite('0'.repeat(64)).invite.findMany()).toEqual([]);
    expect(() => db.forInvite("x' OR 1=1 --")).toThrow(/invalid invite token hash/i);
  });
});

describe('platform scope', () => {
  it('sees firms and applications but no firm data', async () => {
    const p = db.forPlatform();
    const firms = (await p.business.findMany()).map((x) => x.id);
    expect(firms).toEqual(expect.arrayContaining([ids.firmA, ids.firmB]));
    expect((await p.firmApplication.findMany()).length).toBeGreaterThan(0);
    expect(await p.membership.findMany()).toEqual([]);
    expect(await p.clientAccount.findMany()).toEqual([]);
    expect((await p.auditLog.findMany()).every((r) => r.businessId === null)).toBe(true);
    expect(await p.businessSettings.findMany()).toEqual([]);
    expect(await p.firmLegalDocument.findMany()).toEqual([]);
    expect(await p.legalAcceptance.findMany()).toEqual([]);
    expect(await p.taxStatus.findMany()).toEqual([]);
    expect(await p.invite.findMany()).toEqual([]);
    expect(await p.client.findMany()).toEqual([]);
    expect(await p.clientProfile.findMany()).toEqual([]);
    expect(await p.clientTaxStatus.findMany()).toEqual([]);
    expect(await p.clientTaxStatusHistory.findMany()).toEqual([]);
    expect(await p.service.findMany()).toEqual([]);
    expect(await p.engagement.findMany()).toEqual([]);
    expect(await p.engagementStatusHistory.findMany()).toEqual([]);
    expect(await p.task.findMany()).toEqual([]);
    expect(await p.note.findMany()).toEqual([]);
    expect(await p.engagementReport.findMany()).toEqual([]);
    expect(await p.documentCategory.findMany()).toEqual([]);
    expect(await p.documentRequest.findMany()).toEqual([]);
    expect(await p.document.findMany()).toEqual([]);
    expect(await p.intakeForm.findMany()).toEqual([]);
    expect(await p.intake.findMany()).toEqual([]);
    expect(await p.lead.findMany()).toEqual([]);
    expect(await p.leadUpload.findMany()).toEqual([]);
    expect(await p.notification.findMany()).toEqual([]);
    expect(await p.notificationDelivery.findMany()).toEqual([]);
    expect(await p.notificationPreference.findMany()).toEqual([]);
    expect(await p.appointmentType.findMany()).toEqual([]);
    expect(await p.workingHours.findMany()).toEqual([]);
    expect(await p.blockedTime.findMany()).toEqual([]);
    expect(await p.appointment.findMany()).toEqual([]);
    expect(await p.messageThread.findMany()).toEqual([]);
    expect(await p.message.findMany()).toEqual([]);
    expect(await p.clientPrivateNote.findMany()).toEqual([]);
    expect(await p.clientNoteReminder.findMany()).toEqual([]);
    expect(await p.invoice.findMany()).toEqual([]);
    expect(await p.payment.findMany()).toEqual([]);
    expect(await p.paymentEvent.findMany()).toEqual([]);
    expect(await p.contentItem.findMany()).toEqual([]);
  });
});

describe('audit log', () => {
  it('is append-only for the app role', async () => {
    await expect(
      db.withScope({ kind: 'business', businessId: ids.firmA }, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.withScope({ kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.updateMany({ data: { action: 'changed' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('withScope transactions', () => {
  it('keeps every statement in the transaction inside the scope', async () => {
    const counts = await db.withScope({ kind: 'business', businessId: ids.firmA }, async (tx) => {
      const viaModel = await tx.membership.count();
      const viaRaw = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM memberships`;
      return { viaModel, viaRaw: Number(viaRaw[0]?.n) };
    });
    expect(counts).toEqual({ viaModel: 1, viaRaw: 1 });
  });

  it('rejects a malformed business id before touching the database', () => {
    expect(() => db.forBusiness("x' OR 1=1 --")).toThrow(/invalid business id/i);
  });
});
