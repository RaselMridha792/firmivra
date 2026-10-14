// R37 seed rows: synthetic examples for the tables and columns added for Intake Forms, Documents,
// Tax Returns, Appointments, Clients and Leads (LVP only). One function, called once by seed.ts;
// safe to run again (fixed ids, upserts or create-once). No real client data.
import type { TxClient } from '../src/client.js';
import {
  SEED_CALENDAR_IDS,
  SEED_CLIENT_IDS,
  SEED_DOCUMENT_IDS,
  SEED_INTAKE_IDS,
  SEED_TAX_RETURN_IDS,
  SEED_USERS,
  SEED_WORK_IDS,
} from './seed-data.js';

/** Fixed ids of the R37 rows (RFC 9562 UUIDs, variant 8). */
const ID = {
  intakeDraft: '00000000-0000-4a37-8000-000000000001',
  shortTaxTemplate: '00000000-0000-4a37-8000-000000000002',
  folderClientDocs: '00000000-0000-4a37-8000-000000000011',
  folderPersonalTax: '00000000-0000-4a37-8000-000000000012',
  folderFirmInternal: '00000000-0000-4a37-8000-000000000013',
  requestType: '00000000-0000-4a37-8000-000000000021',
  requestTypeItem1: '00000000-0000-4a37-8000-000000000022',
  requestTypeItem2: '00000000-0000-4a37-8000-000000000023',
  shareClient: '00000000-0000-4a37-8000-000000000031',
  shareMember: '00000000-0000-4a37-8000-000000000032',
  filing2025Federal: '00000000-0000-4a37-8000-000000000041',
  filing2025State: '00000000-0000-4a37-8000-000000000042',
  filing2024Federal: '00000000-0000-4a37-8000-000000000043',
  attempt2024: '00000000-0000-4a37-8000-000000000044',
  approvalPreparer: '00000000-0000-4a37-8000-000000000051',
  approvalFinal: '00000000-0000-4a37-8000-000000000052',
  checkPrep: '00000000-0000-4a37-8000-000000000053',
  checkValid: '00000000-0000-4a37-8000-000000000054',
  checkWarning: '00000000-0000-4a37-8000-000000000055',
  authFederal: '00000000-0000-4a37-8000-000000000056',
  authState: '00000000-0000-4a37-8000-000000000057',
  returnFile: '00000000-0000-4a37-8000-000000000058',
  officeMain: '00000000-0000-4a37-8000-000000000071',
  roomConference: '00000000-0000-4a37-8000-000000000072',
  reminderEmail: '00000000-0000-4a37-8000-000000000073',
  reminderSms: '00000000-0000-4a37-8000-000000000074',
  series: '00000000-0000-4a37-8000-000000000075',
  override: '00000000-0000-4a37-8000-000000000076',
  tagBackTaxes: '00000000-0000-4a37-8000-000000000081',
  tagW2: '00000000-0000-4a37-8000-000000000082',
  activityCall: '00000000-0000-4a37-8000-000000000091',
  activityNote: '00000000-0000-4a37-8000-000000000092',
  requestPacket: '00000000-0000-4a37-8000-000000000024',
} as const;

/** Intake Forms: the firm's settings, a draft send, and the send setup of the seeded intake. */
async function seedIntakeSend(tx: TxClient, businessId: string) {
  await tx.intakeSettings.upsert({
    where: { businessId },
    update: {},
    create: { businessId, defaultOwnerUserId: SEED_USERS.lvpOwner.id },
  });
  await tx.intake.update({
    where: { id: SEED_INTAKE_IDS.taxIntake },
    data: {
      assignedUserId: SEED_USERS.lvpStaff.id,
      deliveryChannel: 'PORTAL',
      expiresAt: new Date('2026-12-15T12:00:00Z'),
    },
  });
  const form = await tx.intake.findUniqueOrThrow({ where: { id: SEED_INTAKE_IDS.leadIntake } });
  await tx.intake.upsert({
    where: { id: ID.intakeDraft },
    update: {},
    create: {
      id: ID.intakeDraft,
      businessId,
      formId: form.formId,
      engagementId: SEED_WORK_IDS.lvpBookkeeping,
      status: 'DRAFT',
      deliveryChannel: 'EMAIL',
      messageSubject: 'Your bookkeeping intake',
      messageBody: 'Hello, please fill in this short form before our meeting.',
    },
  });
}

/** Intake Forms: a second Annual Tax template (a short organizer) next to the service's default. */
async function seedIntakeTemplates(tx: TxClient, businessId: string) {
  const base = await tx.intakeForm.findFirstOrThrow({
    where: { businessId, service: { name: 'Annual Tax' }, status: 'PUBLISHED' },
  });
  await tx.intakeTemplate.upsert({
    where: { id: ID.shortTaxTemplate },
    update: {},
    create: {
      id: ID.shortTaxTemplate,
      businessId,
      serviceId: base.serviceId,
      internalNotes: 'For returning clients with no life changes.',
      defaultAssignedUserId: SEED_USERS.lvpStaff.id,
      createdByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  if (!(await tx.intakeForm.findFirst({ where: { templateId: ID.shortTaxTemplate } }))) {
    await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: base.serviceId,
        templateId: ID.shortTaxTemplate,
        version: 1,
        title: 'Annual Tax short organizer',
        definition: base.definition ?? {},
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdByUserId: SEED_USERS.lvpOwner.id,
      },
    });
  }
}

/** Documents: a small folder tree, and the library details of the seeded documents. */
async function seedDocumentLibrary(tx: TxClient, businessId: string) {
  const folder = (
    id: string,
    name: string,
    extra: { scope?: 'CLIENT' | 'FIRM'; parentId?: string; sortOrder: number },
  ) =>
    tx.documentFolder.upsert({
      where: { id },
      update: {},
      create: { id, businessId, name, color: extra.scope === 'FIRM' ? 'GRAY' : 'BLUE', ...extra },
    });
  await folder(ID.folderClientDocs, 'Client Documents', { sortOrder: 1 });
  await tx.documentFolder.upsert({
    where: { id: ID.folderPersonalTax },
    update: {},
    create: {
      id: ID.folderPersonalTax,
      businessId,
      name: 'Personal Tax',
      parentId: ID.folderClientDocs,
      sortOrder: 1,
      allowClientUploads: true,
      defaultClientAccess: 'VIEW_UPLOAD',
      requireExpiryDate: false,
    },
  });
  await folder(ID.folderFirmInternal, 'Firm Internal', { scope: 'FIRM', sortOrder: 2 });
  await tx.document.update({
    where: { id: SEED_DOCUMENT_IDS.return2024 },
    data: {
      folderId: ID.folderPersonalTax,
      description: 'Filed 2024 Form 1040 (synthetic)',
      tags: ['1040', 'filed'],
      reviewStatus: 'COMPLETED',
      reviewerUserId: SEED_USERS.lvpOwner.id,
      reviewedAt: new Date('2025-04-10T15:00:00Z'),
      reviewedByUserId: SEED_USERS.lvpOwner.id,
      notifyClient: true,
    },
  });
  await tx.document.update({
    where: { id: SEED_DOCUMENT_IDS.interestDocument },
    data: {
      folderId: ID.folderPersonalTax,
      description: '1099-INT from the bank (synthetic)',
      tags: ['1099-INT'],
      reviewStatus: 'NEEDS_REVIEW',
      reviewerUserId: SEED_USERS.lvpStaff.id,
    },
  });
}

/** Documents: a request type, and the seeded tax requests grouped as one sent request. */
async function seedDocumentRequests(tx: TxClient, businessId: string) {
  await tx.documentRequestTemplate.upsert({
    where: { id: ID.requestType },
    update: {},
    create: {
      id: ID.requestType,
      businessId,
      name: 'Personal Tax Intake',
      description: 'The usual documents for a personal return',
    },
  });
  for (const [id, title, sortOrder, required] of [
    [ID.requestTypeItem1, 'W-2 from your employer', 1, true],
    [ID.requestTypeItem2, 'Photo ID (optional)', 2, false],
  ] as const) {
    await tx.documentRequestTemplateItem.upsert({
      where: { id },
      update: {},
      create: { id, businessId, templateId: ID.requestType, title, sortOrder, required },
    });
  }
  // Items join a request while it is a draft; then it is sent.
  if (await tx.documentRequestPacket.findUnique({ where: { id: ID.requestPacket } })) return;
  await tx.documentRequestPacket.create({
    data: {
      id: ID.requestPacket,
      businessId,
      clientId: SEED_CLIENT_IDS.lvp,
      engagementId: SEED_WORK_IDS.lvpTax,
      templateId: ID.requestType,
      title: '2025 Personal Tax documents',
      dueOn: new Date('2026-10-31'),
      messageSubject: 'Documents for your 2025 return',
      messageBody: 'Hello, please upload the documents below before October 31.',
      reminderDaysBefore: 3,
      assignedUserId: SEED_USERS.lvpStaff.id,
      requestedByUserId: SEED_USERS.lvpStaff.id,
    },
  });
  for (const [id, sortOrder] of [
    [SEED_DOCUMENT_IDS.w2Request, 1],
    [SEED_DOCUMENT_IDS.interestRequest, 2],
  ] as const) {
    await tx.documentRequest.update({
      where: { id },
      data: { packetId: ID.requestPacket, sortOrder },
    });
  }
  await tx.documentRequestPacket.update({
    where: { id: ID.requestPacket },
    data: { status: 'OPEN' },
  });
}

/** Documents: the filed return shared with the client's login and with the staff member, and the
 * firm's document settings. */
async function seedDocumentShares(tx: TxClient, businessId: string) {
  const login = await tx.clientAccount.findFirstOrThrow({
    where: { businessId, userId: SEED_USERS.lvpClient.id },
  });
  await tx.documentShare.upsert({
    where: { id: ID.shareClient },
    update: {},
    create: {
      id: ID.shareClient,
      businessId,
      documentId: SEED_DOCUMENT_IDS.return2024,
      recipientKind: 'CLIENT',
      clientAccountId: login.id,
      canUpload: true,
      grantedByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  await tx.documentShare.upsert({
    where: { id: ID.shareMember },
    update: {},
    create: {
      id: ID.shareMember,
      businessId,
      documentId: SEED_DOCUMENT_IDS.return2024,
      recipientKind: 'MEMBER',
      memberUserId: SEED_USERS.lvpStaff.id,
      grantedByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  await tx.documentSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      requestReminderDaysBefore: 3,
      shareExpiryDays: 30,
      uploadTypes: ['application/pdf', 'image/jpeg', 'image/png'],
      defaultReviewerUserId: SEED_USERS.lvpStaff.id,
    },
  });
}

/** Tax Returns: the 2025 return in review with its people, filing status and deadline. */
async function seedTaxReturnWorkflow(tx: TxClient, businessId: string) {
  await tx.taxReturn.update({
    where: { id: SEED_TAX_RETURN_IDS.lvp2025 },
    data: {
      workflowStatus: 'READY_FOR_REVIEW',
      preparerUserId: SEED_USERS.lvpStaff.id,
      reviewerUserId: SEED_USERS.lvpOwner.id,
      filingStatus: 'SINGLE',
      dueOn: new Date('2026-10-15'),
      updatedByUserId: SEED_USERS.lvpStaff.id,
    },
  });
  // The 2025 return's two jurisdictions, expected amounts only; the accepted 2024 federal return
  // with the one recorded transmission and its acknowledgment.
  const filing = (id: string, taxReturnId: string, jurisdiction: string, data = {}) =>
    tx.taxReturnFiling.upsert({
      where: { id },
      update: {},
      create: { id, businessId, taxReturnId, jurisdiction, ...data },
    });
  await filing(ID.filing2025Federal, SEED_TAX_RETURN_IDS.lvp2025, 'US', {
    refundCents: 284_200,
    amountStatus: 'ESTIMATED',
  });
  await filing(ID.filing2025State, SEED_TAX_RETURN_IDS.lvp2025, 'GA', {
    refundCents: 31_600,
    amountStatus: 'ESTIMATED',
  });
  await filing(ID.filing2024Federal, SEED_TAX_RETURN_IDS.lvp2024, 'US', {
    refundCents: 120_000,
    amountStatus: 'FINAL',
  });
  // Review: the preparer's review is done, the final one waits; a checklist and a validation
  // with one warning nobody has acknowledged yet.
  const taxReturnId = SEED_TAX_RETURN_IDS.lvp2025;
  await tx.taxReturnApproval.upsert({
    where: { id: ID.approvalPreparer },
    update: {},
    create: {
      id: ID.approvalPreparer,
      businessId,
      taxReturnId,
      step: 'Preparer Review',
      sortOrder: 1,
      assignedUserId: SEED_USERS.lvpStaff.id,
      status: 'APPROVED',
      decidedAt: new Date('2026-09-18T16:12:00Z'),
      decidedByUserId: SEED_USERS.lvpStaff.id,
    },
  });
  await tx.taxReturnApproval.upsert({
    where: { id: ID.approvalFinal },
    update: {},
    create: {
      id: ID.approvalFinal,
      businessId,
      taxReturnId,
      step: 'Final Review / Approval',
      sortOrder: 2,
      assignedUserId: SEED_USERS.lvpOwner.id,
    },
  });
  for (const [id, section, label, result, sortOrder] of [
    [ID.checkPrep, 'PREPARATION', 'All W-2s entered', 'DONE', 1],
    [ID.checkValid, 'VALIDATION', 'Names and SSNs match the client record', 'VALID', 1],
    [ID.checkWarning, 'VALIDATION', 'Bank account for the refund not provided', 'WARNING', 2],
  ] as const) {
    await tx.taxReturnChecklistItem.upsert({
      where: { id },
      update: {},
      create: { id, businessId, taxReturnId, section, label, result, sortOrder },
    });
  }
  // Signature lines of the 2025 return (nothing sent yet), and the filed 2024 return's file.
  for (const [id, kind, jurisdiction] of [
    [ID.authFederal, 'FEDERAL_EFILE', null],
    [ID.authState, 'STATE_EFILE', 'GA'],
  ] as const) {
    await tx.taxReturnAuthorization.upsert({
      where: { id },
      update: {},
      create: { id, businessId, taxReturnId, kind, jurisdiction },
    });
  }
  await tx.taxReturnDocument.upsert({
    where: { id: ID.returnFile },
    update: {},
    create: {
      id: ID.returnFile,
      businessId,
      taxReturnId: SEED_TAX_RETURN_IDS.lvp2024,
      documentId: SEED_DOCUMENT_IDS.return2024,
      kind: 'FILED_RETURN',
      jurisdiction: 'US',
      createdByUserId: SEED_USERS.lvpStaff.id,
    },
  });
  if (!(await tx.taxReturnFilingAttempt.findUnique({ where: { id: ID.attempt2024 } }))) {
    await tx.taxReturnFilingAttempt.create({
      data: {
        id: ID.attempt2024,
        businessId,
        filingId: ID.filing2024Federal,
        submissionId: 'SUB-2024-0001',
        transmittedAt: new Date('2025-04-12T14:00:00Z'),
        ackStatus: 'ACCEPTED',
        acknowledgedAt: new Date('2025-04-12T18:30:00Z'),
        recordedByUserId: SEED_USERS.lvpStaff.id,
      },
    });
  }
}

/** Appointments: the seeded consultation, confirmed, with notes, colour and its service. */
async function seedAppointmentDetails(tx: TxClient, businessId: string) {
  const service = await tx.service.findFirstOrThrow({ where: { businessId, name: 'Annual Tax' } });
  await tx.appointment.update({
    where: { id: SEED_CALENDAR_IDS.appointment },
    data: {
      serviceId: service.id,
      color: 'BLUE',
      confirmedAt: new Date('2026-10-12T15:00:00Z'),
      clientInstructions: "Bring last year's return and your W-2s.",
      internalNotes: 'Client asked about the home office deduction.',
    },
  });
  // The firm's main office and a room, and the reminders the consultation will send.
  await tx.firmOffice.upsert({
    where: { id: ID.officeMain },
    update: {},
    create: {
      id: ID.officeMain,
      businessId,
      name: 'Main Office',
      addressLine1: '100 Example Street',
      city: 'Auburn',
      state: 'GA',
      postalCode: '30011',
      isMain: true,
    },
  });
  await tx.firmRoom.upsert({
    where: { id: ID.roomConference },
    update: {},
    create: {
      id: ID.roomConference,
      businessId,
      officeId: ID.officeMain,
      name: 'Conference Room 1',
    },
  });
  // A weekly series (record only), a day off for the staff member, and the firm's settings.
  await tx.appointmentSeries.upsert({
    where: { id: ID.series },
    update: {},
    create: {
      id: ID.series,
      businessId,
      frequency: 'WEEKLY',
      byWeekdays: [2],
      occurrenceCount: 8,
      timeZone: 'America/New_York',
      createdByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  await tx.availabilityOverride.upsert({
    where: { id: ID.override },
    update: {},
    create: {
      id: ID.override,
      businessId,
      userId: SEED_USERS.lvpStaff.id,
      date: new Date('2026-12-24'),
    },
  });
  await tx.appointmentSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      defaultBufferMinutes: 10,
      bookingMinNoticeMinutes: 1440,
      bookingMaxAdvanceDays: 90,
      copyEmail: 'hello@lvp.test',
    },
  });
  for (const [id, channel, offsetMinutes] of [
    [ID.reminderEmail, 'EMAIL', 1440],
    [ID.reminderSms, 'SMS', 120],
  ] as const) {
    await tx.appointmentReminder.upsert({
      where: { id },
      update: {},
      create: {
        id,
        businessId,
        appointmentId: SEED_CALENDAR_IDS.appointment,
        channel,
        offsetMinutes,
      },
    });
  }
}

/** Clients: the LVP client as an active, referred client. */
async function seedClientFields(tx: TxClient, businessId: string) {
  await tx.client.update({
    where: { id: SEED_CLIENT_IDS.lvp },
    data: {
      status: 'ACTIVE',
      priority: 'MEDIUM',
      source: 'REFERRAL',
      sourceDetail: 'Referred by a current client',
      clientSince: new Date('2024-01-12'),
      updatedByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  await tx.clientProfile.update({
    where: { clientId: SEED_CLIENT_IDS.lvp },
    data: { county: 'Gwinnett' },
  });
  for (const [id, name] of [
    [ID.tagBackTaxes, 'Back Taxes'],
    [ID.tagW2, 'W-2'],
  ] as const) {
    await tx.tag.upsert({
      where: { id },
      update: {},
      create: { id, businessId, name, createdByUserId: SEED_USERS.lvpOwner.id },
    });
    await tx.clientTag.upsert({
      where: { clientId_tagId: { clientId: SEED_CLIENT_IDS.lvp, tagId: id } },
      update: {},
      create: {
        businessId,
        clientId: SEED_CLIENT_IDS.lvp,
        tagId: id,
        addedByUserId: SEED_USERS.lvpStaff.id,
      },
    });
  }
}

/** Leads: Begin Online's lead with a source, owner, follow-up, a second service and a tag. */
async function seedLeadFields(tx: TxClient, businessId: string) {
  await tx.lead.update({
    where: { id: SEED_INTAKE_IDS.lead },
    data: {
      source: 'BEGIN_ONLINE',
      priority: 'WARM',
      assignedUserId: SEED_USERS.lvpStaff.id,
      preferredContactMethods: ['EMAIL', 'PHONE'],
      bestTimeToContact: 'Evenings (after 5 PM)',
      nextActionType: 'CALL',
      nextActionAt: new Date('2026-12-01T15:00:00Z'),
      nextActionNote: 'Ask about the 2025 bookkeeping backlog',
      updatedByUserId: SEED_USERS.lvpStaff.id,
    },
  });
  const payroll = await tx.service.findFirstOrThrow({ where: { businessId, name: 'Payroll' } });
  // The timeline: the database wrote CREATED; a logged call and a note.
  for (const [id, kind, summary, body] of [
    [ID.activityCall, 'CALL', 'Intro call', null],
    [ID.activityNote, 'NOTE', null, 'Prefers evening calls; has two years of unfiled bookkeeping.'],
  ] as const) {
    if (!(await tx.leadActivity.findUnique({ where: { id } }))) {
      await tx.leadActivity.create({
        data: {
          id,
          businessId,
          leadId: SEED_INTAKE_IDS.lead,
          kind,
          summary,
          body,
          actorUserId: SEED_USERS.lvpStaff.id,
        },
      });
    }
  }
  await tx.leadService.upsert({
    where: { leadId_serviceId: { leadId: SEED_INTAKE_IDS.lead, serviceId: payroll.id } },
    update: {},
    create: { businessId, leadId: SEED_INTAKE_IDS.lead, serviceId: payroll.id },
  });
  await tx.leadTag.upsert({
    where: { leadId_tagId: { leadId: SEED_INTAKE_IDS.lead, tagId: ID.tagBackTaxes } },
    update: {},
    create: {
      businessId,
      leadId: SEED_INTAKE_IDS.lead,
      tagId: ID.tagBackTaxes,
      addedByUserId: SEED_USERS.lvpStaff.id,
    },
  });
}

export async function seedR37(tx: TxClient, businessId: string) {
  await seedIntakeSend(tx, businessId);
  await seedIntakeTemplates(tx, businessId);
  await seedDocumentLibrary(tx, businessId);
  await seedDocumentRequests(tx, businessId);
  await seedDocumentShares(tx, businessId);
  await seedTaxReturnWorkflow(tx, businessId);
  await seedAppointmentDetails(tx, businessId);
  await seedClientFields(tx, businessId);
  await seedLeadFields(tx, businessId);
}
