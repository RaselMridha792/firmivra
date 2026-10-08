// Seeds the local database: a Super Admin, LVP Accounting & Taxes (owner, staff, invited staff, client) and
// Test Firm B for isolation checks. Safe to run again. Runs as the owner role, inside the same
// scopes the app uses, so it also works where the owner is not a superuser.
import { createHash, randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import {
  SEED_BUSINESSES,
  SEED_CLIENT_IDS,
  SEED_INVITE_ID,
  SEED_OWNER_INVITE_ID,
  SEED_SERVICES,
  SEED_TAX_STATUSES,
  SEED_USERS,
  SEED_WORK_IDS,
  SEED_DOCUMENT_CATEGORIES,
  SEED_DOCUMENT_IDS,
  SEED_TAX_RETURN_IDS,
  SEED_INTAKE_IDS,
  SEED_NOTIFICATION_IDS,
  SEED_APPOINTMENT_TYPES,
  SEED_CALENDAR_IDS,
  SEED_MESSAGE_IDS,
  SEED_BILLING_IDS,
  SEED_STRIPE_ACCOUNT_ID,
  SEED_PLATFORM_IDS,
  SAMPLE_FORM_DEFINITION,
} from './seed-data.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
// The seed runs a few large transactions, sometimes next to the test suites (seed.test.ts): give
// them time to start and finish.
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

/** Settings, Terms and Privacy v1 and tax statuses for one firm (business scope). */
async function seedFirmBasics(
  tx: TxClient,
  businessId: string,
  firm: {
    name: string;
    ownerId: string;
    contactEmail: string;
    brandColor?: string;
    taxStatuses: readonly string[];
  },
) {
  await tx.businessSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      contactEmail: firm.contactEmail,
      brandColor: firm.brandColor ?? null,
      setupCompletedAt: new Date(),
    },
  });
  for (const [kind, title] of [
    ['TERMS', 'Terms of Service'],
    ['PRIVACY', 'Privacy Policy'],
  ] as const) {
    await tx.firmLegalDocument.upsert({
      where: { businessId_kind_version: { businessId, kind, version: 1 } },
      update: {},
      create: {
        businessId,
        kind,
        version: 1,
        body: `# ${firm.name}: ${title}\n\nSample text for local development. Not legal text.`,
        publishedByUserId: firm.ownerId,
      },
    });
  }
  for (const [sortOrder, name] of firm.taxStatuses.entries()) {
    await tx.taxStatus.upsert({
      where: { businessId_name: { businessId, name } },
      update: { sortOrder },
      create: { businessId, name, sortOrder },
    });
  }
}

/** The firm's client record and profile for a seeded client login, linked to that login. */
async function seedClient(
  tx: TxClient,
  businessId: string,
  clientId: string,
  user: { id: string; email: string; name: string },
  assignedUserId: string,
) {
  const [firstName, lastName] = user.name.split(' ');
  await tx.client.upsert({
    where: { id: clientId },
    update: {},
    create: { id: clientId, businessId, displayName: user.name, email: user.email, assignedUserId },
  });
  await tx.clientProfile.upsert({
    where: { clientId },
    update: {},
    create: { clientId, businessId, firstName: firstName ?? null, lastName: lastName ?? null },
  });
  await tx.clientAccount.update({ where: { userId: user.id }, data: { clientId } });
}

/** The firm's services; returns their ids by name. */
async function seedServices(
  tx: TxClient,
  businessId: string,
  services: (typeof SEED_SERVICES)[keyof typeof SEED_SERVICES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, s] of services.entries()) {
    const data = {
      kind: s.kind,
      billingInterval: s.billingInterval,
      packages: [...s.packages],
      stages: [...s.stages],
      sortOrder,
    };
    const row = await tx.service.upsert({
      where: { businessId_name: { businessId, name: s.name } },
      update: data,
      create: { businessId, name: s.name, ...data },
    });
    ids.set(s.name, row.id);
  }
  return byName('service', ids);
}

/** The firm's document categories; returns their ids by name. */
async function seedDocumentCategories(
  tx: TxClient,
  businessId: string,
  categories: (typeof SEED_DOCUMENT_CATEGORIES)[keyof typeof SEED_DOCUMENT_CATEGORIES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, c] of categories.entries()) {
    const data = { sortOrder, retentionYears: c.retentionYears };
    const row = await tx.documentCategory.upsert({
      where: { businessId_name: { businessId, name: c.name } },
      update: data,
      create: { businessId, name: c.name, ...data },
    });
    ids.set(c.name, row.id);
  }
  return byName('document category', ids);
}

/** A published v1 intake form for each named service; returns their ids by service name. */
async function seedIntakeForms(
  tx: TxClient,
  businessId: string,
  service: (name: string) => string,
  serviceNames: readonly string[],
) {
  const ids = new Map<string, string>();
  for (const name of serviceNames) {
    const serviceId = service(name);
    const row = await tx.intakeForm.upsert({
      where: { businessId_serviceId_version: { businessId, serviceId, version: 1 } },
      update: {},
      create: {
        businessId,
        serviceId,
        version: 1,
        title: `${name} intake`,
        definition: SAMPLE_FORM_DEFINITION,
        agreementText: `Sample ${name} service agreement for local development. Not legal text.`,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    ids.set(name, row.id);
  }
  return byName('intake form', ids);
}

/** The firm's appointment types; returns their ids by name. */
async function seedAppointmentTypes(
  tx: TxClient,
  businessId: string,
  types: (typeof SEED_APPOINTMENT_TYPES)[keyof typeof SEED_APPOINTMENT_TYPES],
) {
  const ids = new Map<string, string>();
  for (const [sortOrder, t] of types.entries()) {
    const data = {
      durationMinutes: t.durationMinutes,
      locationKind: t.locationKind,
      clientBookable: t.clientBookable,
      sortOrder,
    };
    const row = await tx.appointmentType.upsert({
      where: { businessId_name: { businessId, name: t.name } },
      update: data,
      create: { businessId, name: t.name, ...data },
    });
    ids.set(t.name, row.id);
  }
  return byName('appointment type', ids);
}

function byName(kind: string, ids: Map<string, string>) {
  return (name: string) => {
    const id = ids.get(name);
    if (!id) throw new Error(`Seed ${kind} ${name} is missing`);
    return id;
  };
}

async function main() {
  const businesses = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    for (const u of Object.values(SEED_USERS)) {
      await tx.user.upsert({
        where: { id: u.id },
        update: { email: u.email, name: u.name, pool: u.pool },
        create: { id: u.id, cognitoSub: u.id, pool: u.pool, email: u.email, name: u.name },
      });
    }
    await tx.platformAdmin.upsert({
      where: { userId: SEED_USERS.superAdmin.id },
      update: {},
      create: { userId: SEED_USERS.superAdmin.id, role: 'SUPER_ADMIN' },
    });
    const result: Record<keyof typeof SEED_BUSINESSES, string> = { lvp: '', testFirmB: '' };
    for (const [key, b] of Object.entries(SEED_BUSINESSES) as [
      keyof typeof SEED_BUSINESSES,
      (typeof SEED_BUSINESSES)[keyof typeof SEED_BUSINESSES],
    ][]) {
      const row = await tx.business.upsert({
        where: { slug: b.slug },
        update: { name: b.name, status: b.status },
        create: { slug: b.slug, name: b.name, status: b.status },
      });
      result[key] = row.id;
    }
    return result;
  });

  // LVP is paid into its own Stripe connected account (Stripe Connect), already onboarded.
  // Connected accounts are written only in platform scope (onboarding), never by the firm.
  await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.stripeAccount.upsert({
      where: { businessId: businesses.lvp },
      update: {},
      create: {
        businessId: businesses.lvp,
        accountId: SEED_STRIPE_ACCOUNT_ID,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    }),
  );

  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, async (tx) => {
    for (const [user, role] of [
      [SEED_USERS.lvpOwner, 'OWNER'],
      [SEED_USERS.lvpStaff, 'STAFF'],
    ] as const) {
      await tx.membership.upsert({
        where: { businessId_userId: { businessId: businesses.lvp, userId: user.id } },
        update: { role, status: 'ACTIVE' },
        create: { businessId: businesses.lvp, userId: user.id, role, status: 'ACTIVE' },
      });
    }
    await tx.clientAccount.upsert({
      where: { userId: SEED_USERS.lvpClient.id },
      update: { status: 'ACTIVE' },
      create: {
        businessId: businesses.lvp,
        userId: SEED_USERS.lvpClient.id,
        email: SEED_USERS.lvpClient.email,
        status: 'ACTIVE',
      },
    });
    await seedFirmBasics(tx, businesses.lvp, {
      name: SEED_BUSINESSES.lvp.name,
      ownerId: SEED_USERS.lvpOwner.id,
      contactEmail: 'hello@lvp.test',
      brandColor: '#1f4e79',
      taxStatuses: SEED_TAX_STATUSES.lvp,
    });

    // A staff member invited but not yet active, with one open invite.
    const invited = await tx.membership.upsert({
      where: {
        businessId_userId: { businessId: businesses.lvp, userId: SEED_USERS.lvpInvited.id },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        userId: SEED_USERS.lvpInvited.id,
        role: 'STAFF',
        status: 'INVITED',
      },
    });
    await tx.invite.upsert({
      where: { id: SEED_INVITE_ID },
      update: {},
      create: {
        id: SEED_INVITE_ID,
        businessId: businesses.lvp,
        membershipId: invited.id,
        name: SEED_USERS.lvpInvited.name,
        email: SEED_USERS.lvpInvited.email,
        // Random and never printed: the invite shows in the team list, but its link cannot be used.
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        expiresAt: new Date(Date.now() + 6 * 86_400_000),
        invitedByUserId: SEED_USERS.lvpOwner.id,
      },
    });

    await seedClient(
      tx,
      businesses.lvp,
      SEED_CLIENT_IDS.lvp,
      SEED_USERS.lvpClient,
      SEED_USERS.lvpStaff.id,
    );
    await tx.clientProfile.update({
      where: { clientId: SEED_CLIENT_IDS.lvp },
      data: { preferredContactMethod: 'EMAIL', referralSource: 'Friend or family' },
    });
    // At sign-up the client accepted the firm's Terms and Privacy v1.
    const lvpLogin = await tx.clientAccount.findUniqueOrThrow({
      where: { userId: SEED_USERS.lvpClient.id },
    });
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      const doc = await tx.firmLegalDocument.findUniqueOrThrow({
        where: { businessId_kind_version: { businessId: businesses.lvp, kind, version: 1 } },
      });
      await tx.legalAcceptance.upsert({
        where: {
          clientAccountId_legalDocumentId: {
            clientAccountId: lvpLogin.id,
            legalDocumentId: doc.id,
          },
        },
        update: {},
        create: {
          businessId: businesses.lvp,
          clientAccountId: lvpLogin.id,
          legalDocumentId: doc.id,
        },
      });
    }
    // ...and verified their email with a code (only its HMAC is stored; this one is fake).
    const sentCode = await tx.verificationCode.findFirst({
      where: { clientAccountId: lvpLogin.id, channel: 'EMAIL' },
    });
    if (!sentCode) {
      const code = await tx.verificationCode.create({
        data: {
          businessId: businesses.lvp,
          clientAccountId: lvpLogin.id,
          channel: 'EMAIL',
          target: lvpLogin.email,
          codeHash: createHash('sha256').update('seed-verification-code').digest('hex'),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      await tx.verificationCode.update({
        where: { id: code.id },
        data: { attempts: 1, consumedAt: new Date() },
      });
    }
    const inPreparation = await tx.taxStatus.findUniqueOrThrow({
      where: { businessId_name: { businessId: businesses.lvp, name: 'In preparation' } },
    });
    await tx.clientTaxStatus.upsert({
      where: {
        businessId_clientId_taxYear: {
          businessId: businesses.lvp,
          clientId: SEED_CLIENT_IDS.lvp,
          taxYear: 2025,
        },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        clientId: SEED_CLIENT_IDS.lvp,
        taxYear: 2025,
        taxStatusId: inPreparation.id,
        clientNote: 'We have your documents and are preparing your return.',
        updatedByUserId: SEED_USERS.lvpStaff.id,
      },
    });

    // Services, a tax engagement with a task and a note, and a bookkeeping engagement with a
    // published reconciliation in its workspace.
    const service = await seedServices(tx, businesses.lvp, SEED_SERVICES.lvp);
    const lvpWork = {
      businessId: businesses.lvp,
      clientId: SEED_CLIENT_IDS.lvp,
      assignedUserId: SEED_USERS.lvpStaff.id,
      updatedByUserId: SEED_USERS.lvpStaff.id,
    };
    await tx.engagement.upsert({
      where: { id: SEED_WORK_IDS.lvpTax },
      update: {},
      create: {
        ...lvpWork,
        id: SEED_WORK_IDS.lvpTax,
        serviceId: service('Annual Tax'),
        title: '2025 Personal Tax',
        taxYear: 2025,
        stage: 'Preparation',
      },
    });
    await tx.engagement.upsert({
      where: { id: SEED_WORK_IDS.lvpBookkeeping },
      update: {},
      create: {
        ...lvpWork,
        id: SEED_WORK_IDS.lvpBookkeeping,
        serviceId: service('Bookkeeping'),
        title: 'Bookkeeping (Growth)',
        package: 'Growth',
        stage: 'Monthly close',
        billingInterval: 'MONTHLY',
        periodStart: new Date('2026-01-01'),
        nextBillingOn: new Date('2026-11-01'),
      },
    });
    // Last year's return, done and filed.
    await tx.engagement.upsert({
      where: { id: SEED_WORK_IDS.lvpTax2024 },
      update: {},
      create: {
        ...lvpWork,
        id: SEED_WORK_IDS.lvpTax2024,
        serviceId: service('Annual Tax'),
        title: '2024 Personal Tax',
        taxYear: 2024,
        status: 'COMPLETED',
        completedAt: new Date('2025-04-12T16:00:00Z'),
      },
    });
    await tx.task.upsert({
      where: { id: SEED_WORK_IDS.lvpTask },
      update: {},
      create: {
        id: SEED_WORK_IDS.lvpTask,
        businessId: businesses.lvp,
        clientId: SEED_CLIENT_IDS.lvp,
        engagementId: SEED_WORK_IDS.lvpTax,
        title: 'Check the W-2 against last year',
        dueOn: new Date('2026-10-20'),
        assignedUserId: SEED_USERS.lvpStaff.id,
        createdByUserId: SEED_USERS.lvpOwner.id,
      },
    });
    await tx.note.upsert({
      where: { id: SEED_WORK_IDS.lvpNote },
      update: {},
      create: {
        id: SEED_WORK_IDS.lvpNote,
        businessId: businesses.lvp,
        clientId: SEED_CLIENT_IDS.lvp,
        engagementId: SEED_WORK_IDS.lvpTax,
        body: 'Sample note: prefers contact by email.',
        authorUserId: SEED_USERS.lvpStaff.id,
      },
    });
    await tx.engagementReport.upsert({
      where: { id: SEED_WORK_IDS.lvpReport },
      update: {},
      create: {
        id: SEED_WORK_IDS.lvpReport,
        businessId: businesses.lvp,
        engagementId: SEED_WORK_IDS.lvpBookkeeping,
        kind: 'RECONCILIATION',
        title: 'Business checking reconciliation',
        periodLabel: 'September 2026',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        data: { statementBalanceCents: 1250000, bookBalanceCents: 1250000 },
        createdByUserId: SEED_USERS.lvpStaff.id,
      },
    });

    // Document categories, two requests on the 2025 tax engagement, and one scanned client
    // upload answering one of them. No file exists behind it in local S3.
    const category = await seedDocumentCategories(tx, businesses.lvp, SEED_DOCUMENT_CATEGORIES.lvp);
    const taxEngagement = {
      businessId: businesses.lvp,
      clientId: SEED_CLIENT_IDS.lvp,
      engagementId: SEED_WORK_IDS.lvpTax,
      categoryId: category('W-2 and 1099'),
    };
    await tx.documentRequest.upsert({
      where: { id: SEED_DOCUMENT_IDS.w2Request },
      update: {},
      create: {
        ...taxEngagement,
        id: SEED_DOCUMENT_IDS.w2Request,
        title: 'W-2 from your employer',
        instructions: 'Upload every W-2 you received for 2025.',
        dueOn: new Date('2026-10-31'),
        requestedByUserId: SEED_USERS.lvpStaff.id,
      },
    });
    await tx.documentRequest.upsert({
      where: { id: SEED_DOCUMENT_IDS.interestRequest },
      update: {},
      create: {
        ...taxEngagement,
        id: SEED_DOCUMENT_IDS.interestRequest,
        title: '1099-INT from your bank',
        status: 'SUBMITTED',
        requestedByUserId: SEED_USERS.lvpStaff.id,
      },
    });
    await tx.document.upsert({
      where: { id: SEED_DOCUMENT_IDS.interestDocument },
      update: {},
      create: {
        ...taxEngagement,
        id: SEED_DOCUMENT_IDS.interestDocument,
        requestId: SEED_DOCUMENT_IDS.interestRequest,
        direction: 'CLIENT_TO_FIRM',
        fileName: '1099-INT sample.pdf',
        contentType: 'application/pdf',
        sizeBytes: 48213,
        sha256: createHash('sha256').update('sample 1099-INT').digest('hex'),
        s3Key: `tenant/${businesses.lvp}/documents/${SEED_DOCUMENT_IDS.interestDocument}`,
        taxYear: 2025,
        uploadedByUserId: SEED_USERS.lvpClient.id,
      },
    });
    // New documents start unscanned; mark the seeded one clean once.
    await tx.document.updateMany({
      where: { id: SEED_DOCUMENT_IDS.interestDocument, scanStatus: 'PENDING' },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });

    // The client's tax returns (portal Taxes tab): 2023 from before the portal (no engagement or
    // file), 2024 filed with its PDF shared with the client, and 2025 in progress.
    await tx.document.upsert({
      where: { id: SEED_DOCUMENT_IDS.return2024 },
      update: {},
      create: {
        businessId: businesses.lvp,
        clientId: SEED_CLIENT_IDS.lvp,
        engagementId: SEED_WORK_IDS.lvpTax2024,
        categoryId: category('Final return'),
        id: SEED_DOCUMENT_IDS.return2024,
        direction: 'FIRM_TO_CLIENT',
        fileName: '2024 Tax Return (sample).pdf',
        contentType: 'application/pdf',
        sizeBytes: 182400,
        sha256: createHash('sha256').update('sample 2024 return').digest('hex'),
        s3Key: `tenant/${businesses.lvp}/documents/${SEED_DOCUMENT_IDS.return2024}`,
        taxYear: 2024,
        uploadedByUserId: SEED_USERS.lvpStaff.id,
      },
    });
    await tx.document.updateMany({
      where: { id: SEED_DOCUMENT_IDS.return2024, scanStatus: 'PENDING' },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    const lvpReturn = { businessId: businesses.lvp, clientId: SEED_CLIENT_IDS.lvp };
    for (const data of [
      {
        id: SEED_TAX_RETURN_IDS.lvp2023,
        taxYear: 2023,
        status: 'COMPLETED' as const,
        filedOn: new Date('2024-04-10'),
      },
      {
        id: SEED_TAX_RETURN_IDS.lvp2024,
        engagementId: SEED_WORK_IDS.lvpTax2024,
        taxYear: 2024,
        status: 'ACCEPTED' as const,
        filedOn: new Date('2025-04-12'),
        documentId: SEED_DOCUMENT_IDS.return2024,
      },
      { id: SEED_TAX_RETURN_IDS.lvp2025, engagementId: SEED_WORK_IDS.lvpTax, taxYear: 2025 },
    ]) {
      await tx.taxReturn.upsert({
        where: { id: data.id },
        update: {},
        create: { ...lvpReturn, filingType: 'INDIVIDUAL', formType: '1040', ...data },
      });
    }

    // A published v1 intake form per service, an in-progress portal intake on the 2025 tax
    // engagement, and a submitted Begin Online lead for Bookkeeping with one clean upload.
    const form = await seedIntakeForms(
      tx,
      businesses.lvp,
      service,
      SEED_SERVICES.lvp.map((s) => s.name),
    );
    const lvp = { businessId: businesses.lvp };
    await tx.intake.upsert({
      where: { id: SEED_INTAKE_IDS.taxIntake },
      update: {},
      create: {
        ...lvp,
        id: SEED_INTAKE_IDS.taxIntake,
        formId: form('Annual Tax'),
        engagementId: SEED_WORK_IDS.lvpTax,
        status: 'IN_PROGRESS',
        dueOn: new Date('2026-11-15'),
        createdByUserId: SEED_USERS.lvpStaff.id,
      },
    });
    await tx.intakeSubmission.upsert({
      where: { id: SEED_INTAKE_IDS.taxSubmission },
      update: {},
      create: {
        ...lvp,
        id: SEED_INTAKE_IDS.taxSubmission,
        intakeId: SEED_INTAKE_IDS.taxIntake,
        version: 1,
        answers: { fullName: SEED_USERS.lvpClient.name },
      },
    });

    await tx.lead.upsert({
      where: { id: SEED_INTAKE_IDS.lead },
      update: {},
      create: {
        ...lvp,
        id: SEED_INTAKE_IDS.lead,
        serviceId: service('Bookkeeping'),
        firstName: 'Lena',
        lastName: 'Lead (fake)',
        email: 'lena.lead@begin.test',
        phone: '+15555550123',
      },
    });
    // Uploads are added while the lead is a draft; no file exists behind it in local S3.
    await tx.leadUpload.upsert({
      where: { id: SEED_INTAKE_IDS.leadUpload },
      update: {},
      create: {
        ...lvp,
        id: SEED_INTAKE_IDS.leadUpload,
        leadId: SEED_INTAKE_IDS.lead,
        slot: 'priorReturn',
        fileName: 'Prior return sample.pdf',
        contentType: 'application/pdf',
        sizeBytes: 81234,
        sha256: createHash('sha256').update('sample prior return').digest('hex'),
        s3Key: `tenant/${businesses.lvp}/leads/${SEED_INTAKE_IDS.leadUpload}`,
      },
    });
    await tx.leadUpload.updateMany({
      where: { id: SEED_INTAKE_IDS.leadUpload, scanStatus: 'PENDING' },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    await tx.intake.upsert({
      where: { id: SEED_INTAKE_IDS.leadIntake },
      update: {},
      create: {
        ...lvp,
        id: SEED_INTAKE_IDS.leadIntake,
        formId: form('Bookkeeping'),
        leadId: SEED_INTAKE_IDS.lead,
        status: 'SUBMITTED',
      },
    });
    // A submitted version is locked (even an empty upsert would update it), so create it once.
    const signedAt = new Date();
    if (
      !(await tx.intakeSubmission.findUnique({ where: { id: SEED_INTAKE_IDS.leadSubmission } }))
    ) {
      await tx.intakeSubmission.create({
        data: {
          ...lvp,
          id: SEED_INTAKE_IDS.leadSubmission,
          intakeId: SEED_INTAKE_IDS.leadIntake,
          version: 1,
          answers: { fullName: 'Lena Lead (fake)', package: 'Growth' },
          submittedAt: signedAt,
          signerName: 'Lena Lead (fake)',
          signedAt,
          signerIp: '203.0.113.10',
          signerUserAgent: 'Sample browser (seed)',
        },
      });
    }
    await tx.lead.updateMany({
      where: { id: SEED_INTAKE_IDS.lead, status: 'DRAFT' },
      data: { status: 'SUBMITTED', submittedAt: signedAt },
    });

    // Notifications: the client is asked for a W-2 (email sent, SMS skipped); staff hear about
    // the Begin Online lead (email queued). Payloads hold only safe values.
    const notify = async (
      id: string,
      recipientUserId: string,
      data: {
        category: 'DOCUMENTS' | 'INTAKE';
        type: string;
        entityType: string;
        entityId: string;
        payload?: Record<string, string>;
      },
    ) => {
      await tx.notification.upsert({
        where: { id },
        update: {},
        create: { ...lvp, id, recipientUserId, ...data, payload: data.payload ?? {} },
      });
    };
    const deliver = async (id: string, notificationId: string, channel: 'EMAIL' | 'SMS') => {
      await tx.notificationDelivery.upsert({
        where: { id },
        update: {},
        create: { ...lvp, id, notificationId, channel },
      });
    };
    await notify(SEED_NOTIFICATION_IDS.clientW2, SEED_USERS.lvpClient.id, {
      category: 'DOCUMENTS',
      type: 'document_request.created',
      entityType: 'document_request',
      entityId: SEED_DOCUMENT_IDS.w2Request,
      payload: { dueOn: '2026-10-31' },
    });
    await deliver(SEED_NOTIFICATION_IDS.clientW2Email, SEED_NOTIFICATION_IDS.clientW2, 'EMAIL');
    await tx.notificationDelivery.updateMany({
      where: { id: SEED_NOTIFICATION_IDS.clientW2Email, status: 'QUEUED' },
      data: { status: 'SENT', attempts: 1, sentAt: new Date(), providerMessageId: 'local-sample' },
    });
    await deliver(SEED_NOTIFICATION_IDS.clientW2Sms, SEED_NOTIFICATION_IDS.clientW2, 'SMS');
    await tx.notificationDelivery.updateMany({
      where: { id: SEED_NOTIFICATION_IDS.clientW2Sms, status: 'QUEUED' },
      data: { status: 'SKIPPED' },
    });
    await notify(SEED_NOTIFICATION_IDS.staffLead, SEED_USERS.lvpStaff.id, {
      category: 'INTAKE',
      type: 'lead.submitted',
      entityType: 'lead',
      entityId: SEED_INTAKE_IDS.lead,
    });
    await deliver(SEED_NOTIFICATION_IDS.staffLeadEmail, SEED_NOTIFICATION_IDS.staffLead, 'EMAIL');
    await tx.notificationPreference.upsert({
      where: {
        businessId_userId_category: {
          businessId: businesses.lvp,
          userId: SEED_USERS.lvpClient.id,
          category: 'DOCUMENTS',
        },
      },
      update: {},
      create: { ...lvp, userId: SEED_USERS.lvpClient.id, category: 'DOCUMENTS', sms: true },
    });

    // Calendar: appointment types, the staff member's week (Mon-Fri 9-12 and 1-5, New York
    // time), a firm closure on Thanksgiving, and one client-booked video consultation.
    const appointmentType = await seedAppointmentTypes(
      tx,
      businesses.lvp,
      SEED_APPOINTMENT_TYPES.lvp,
    );
    const staffHours = { ...lvp, userId: SEED_USERS.lvpStaff.id };
    if ((await tx.workingHours.count({ where: staffHours })) === 0) {
      const at = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
      await tx.workingHours.createMany({
        data: [1, 2, 3, 4, 5].flatMap((weekday) => [
          { ...staffHours, weekday, startsAt: at('09:00'), endsAt: at('12:00') },
          { ...staffHours, weekday, startsAt: at('13:00'), endsAt: at('17:00') },
        ]),
      });
    }
    await tx.blockedTime.upsert({
      where: { id: SEED_CALENDAR_IDS.thanksgiving },
      update: {},
      create: {
        ...lvp,
        id: SEED_CALENDAR_IDS.thanksgiving,
        startsAt: new Date('2026-11-26T05:00:00Z'),
        endsAt: new Date('2026-11-27T05:00:00Z'),
        reason: 'Thanksgiving (office closed)',
        createdByUserId: SEED_USERS.lvpOwner.id,
      },
    });
    await tx.appointment.upsert({
      where: { id: SEED_CALENDAR_IDS.appointment },
      update: {},
      create: {
        ...lvp,
        id: SEED_CALENDAR_IDS.appointment,
        clientId: SEED_CLIENT_IDS.lvp,
        engagementId: SEED_WORK_IDS.lvpTax,
        staffUserId: SEED_USERS.lvpStaff.id,
        typeId: appointmentType('Tax consultation'),
        startsAt: new Date('2026-10-20T18:00:00Z'),
        endsAt: new Date('2026-10-20T18:30:00Z'),
        locationKind: 'VIDEO',
        locationDetails: 'The video link is sent before the meeting.',
        bookedByUserId: SEED_USERS.lvpClient.id,
        bookedByClient: true,
      },
    });

    // Messages: the client asks about a W-2 (with the 1099-INT attached) and staff answer;
    // the firm's welcome thread.
    const thread = async (
      id: string,
      data: { subject: string; engagementId?: string; createdByUserId: string },
    ) => {
      await tx.messageThread.upsert({
        where: { id },
        update: {},
        create: { ...lvp, id, clientId: SEED_CLIENT_IDS.lvp, ...data },
      });
    };
    const message = async (
      id: string,
      threadId: string,
      direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM',
      body: string,
      createdAt: string,
    ) => {
      if (!(await tx.message.findUnique({ where: { id } }))) {
        await tx.message.create({
          data: {
            ...lvp,
            id,
            threadId,
            direction,
            body,
            senderUserId:
              direction === 'CLIENT_TO_FIRM' ? SEED_USERS.lvpClient.id : SEED_USERS.lvpStaff.id,
            createdAt: new Date(createdAt),
          },
        });
      }
    };
    await thread(SEED_MESSAGE_IDS.welcomeThread, {
      subject: 'Welcome to LVP!',
      createdByUserId: SEED_USERS.lvpOwner.id,
    });
    await message(
      SEED_MESSAGE_IDS.welcomeMessage,
      SEED_MESSAGE_IDS.welcomeThread,
      'FIRM_TO_CLIENT',
      'Welcome to your client portal. Send us a message here any time.',
      '2026-10-01T14:00:00Z',
    );
    await thread(SEED_MESSAGE_IDS.w2Thread, {
      subject: 'Question about my W-2',
      engagementId: SEED_WORK_IDS.lvpTax,
      createdByUserId: SEED_USERS.lvpClient.id,
    });
    await message(
      SEED_MESSAGE_IDS.w2Question,
      SEED_MESSAGE_IDS.w2Thread,
      'CLIENT_TO_FIRM',
      'Do you need the W-2 from my second job too? I attached my 1099-INT.',
      '2026-10-02T15:00:00Z',
    );
    await tx.messageAttachment.upsert({
      where: {
        businessId_messageId_documentId: {
          businessId: businesses.lvp,
          messageId: SEED_MESSAGE_IDS.w2Question,
          documentId: SEED_DOCUMENT_IDS.interestDocument,
        },
      },
      update: {},
      create: {
        ...lvp,
        messageId: SEED_MESSAGE_IDS.w2Question,
        documentId: SEED_DOCUMENT_IDS.interestDocument,
      },
    });
    await message(
      SEED_MESSAGE_IDS.w2Answer,
      SEED_MESSAGE_IDS.w2Thread,
      'FIRM_TO_CLIENT',
      'Yes, please upload every W-2 under the W-2 request. Thanks for the 1099-INT.',
      '2026-10-02T17:30:00Z',
    );

    // Billing: a paid bookkeeping invoice, paid the only way the database allows (a recorded
    // processor event confirms the payment), and an open invoice for the 2025 return.
    const invoice = async (
      id: string,
      data: { number: string; engagementId: string; line: string; cents: number; dueOn: string },
    ) => {
      if (await tx.invoice.findUnique({ where: { id } })) return false;
      await tx.invoice.create({
        data: {
          ...lvp,
          id,
          clientId: SEED_CLIENT_IDS.lvp,
          engagementId: data.engagementId,
          number: data.number,
          createdByUserId: SEED_USERS.lvpOwner.id,
        },
      });
      await tx.invoiceLine.create({
        data: { ...lvp, invoiceId: id, description: data.line, unitAmountCents: data.cents },
      });
      await tx.invoice.update({
        where: { id },
        data: { status: 'OPEN', issuedAt: new Date(), dueOn: new Date(data.dueOn) },
      });
      return true;
    };
    if (
      await invoice(SEED_BILLING_IDS.paidInvoice, {
        number: 'INV-1000',
        engagementId: SEED_WORK_IDS.lvpBookkeeping,
        line: 'Bookkeeping (Growth), September 2026',
        cents: 30000,
        dueOn: '2026-10-10',
      })
    ) {
      const paidAt = new Date();
      await tx.payment.create({
        data: {
          ...lvp,
          id: SEED_BILLING_IDS.paidPayment,
          invoiceId: SEED_BILLING_IDS.paidInvoice,
          amountCents: 30000,
          processorRef: 'cs_test_seed_inv_1000',
          accountId: SEED_STRIPE_ACCOUNT_ID,
        },
      });
      await tx.paymentEvent.create({
        data: {
          ...lvp,
          processorEventId: 'evt_test_seed_inv_1000',
          accountId: SEED_STRIPE_ACCOUNT_ID,
          type: 'checkout.session.completed',
          paymentId: SEED_BILLING_IDS.paidPayment,
          processedAt: paidAt,
        },
      });
      await tx.payment.update({
        where: { id: SEED_BILLING_IDS.paidPayment },
        data: { status: 'SUCCEEDED', paidAt },
      });
      await tx.invoice.update({
        where: { id: SEED_BILLING_IDS.paidInvoice },
        data: { status: 'PAID', paidAt },
      });
    }
    // A $50 goodwill refund the firm made in its own Stripe dashboard, confirmed by Stripe's event.
    const refundEvent = await tx.paymentEvent.upsert({
      where: {
        processor_processorEventId: {
          processor: 'STRIPE',
          processorEventId: 'evt_test_seed_refund_1000',
        },
      },
      update: {},
      create: {
        ...lvp,
        processorEventId: 'evt_test_seed_refund_1000',
        accountId: SEED_STRIPE_ACCOUNT_ID,
        type: 'charge.refunded',
        paymentId: SEED_BILLING_IDS.paidPayment,
        processedAt: new Date(),
      },
    });
    await tx.paymentRefund.upsert({
      where: {
        processor_processorRefundId: {
          processor: 'STRIPE',
          processorRefundId: 're_testseed1000',
        },
      },
      update: {},
      create: {
        ...lvp,
        paymentId: SEED_BILLING_IDS.paidPayment,
        processorRefundId: 're_testseed1000',
        accountId: SEED_STRIPE_ACCOUNT_ID,
        amountCents: 5000,
        status: 'SUCCEEDED',
        eventId: refundEvent.id,
        refundedAt: new Date(),
      },
    });
    await invoice(SEED_BILLING_IDS.openInvoice, {
      number: 'INV-1001',
      engagementId: SEED_WORK_IDS.lvpTax,
      line: '2025 personal tax return preparation',
      cents: 45000,
      dueOn: '2026-11-15',
    });

    // Content editor records and the Tax Return Calculator.
    const content = async (
      id: string,
      data: {
        kind: 'RESOURCE' | 'TIP' | 'EXTERNAL_LINK';
        category: string;
        title: string;
        body?: string;
        url?: string;
      },
    ) => {
      await tx.contentItem.upsert({
        where: { id },
        update: {},
        create: { ...lvp, id, ...data, publishedAt: new Date() },
      });
    };
    await content(SEED_BILLING_IDS.refundLink, {
      kind: 'EXTERNAL_LINK',
      category: 'External Links',
      title: "IRS: Where's My Refund?",
      url: 'https://www.irs.gov/refunds',
    });
    await content(SEED_BILLING_IDS.transcriptLink, {
      kind: 'EXTERNAL_LINK',
      category: 'External Links',
      title: 'IRS: Get your tax records',
      url: 'https://www.irs.gov/individuals/get-transcript',
    });
    await content(SEED_BILLING_IDS.recordKeeping, {
      kind: 'RESOURCE',
      category: 'Record Keeping',
      title: 'Record keeping basics',
      body: 'Sample resource for local development: keep receipts, statements and prior returns.',
    });
    await content(SEED_BILLING_IDS.receiptsTip, {
      kind: 'TIP',
      category: 'Tax Deductions',
      title: 'Keep your business receipts',
      body: 'Sample tip for local development.',
    });
    await tx.calculatorDefinition.upsert({
      where: { businessId_key: { businessId: businesses.lvp, key: 'tax_return' } },
      update: {},
      create: {
        ...lvp,
        key: 'tax_return',
        title: 'Tax Return Calculator',
        config: { taxYear: 2025, note: 'Sample figures for local development only.' },
        disclaimer: 'This is an estimate only, not tax advice. Your actual result may differ.',
      },
    });
  });

  // LVP's firm application (submitted publicly, approved by the Super Admin, then linked to the
  // firm at provisioning), LVP's platform fields, a pending support request, and one platform and
  // one firm audit event. Each step runs in the scope the app uses for it.
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    await tx.business.update({
      where: { id: businesses.lvp },
      data: { businessType: 'Tax and accounting firm', pack: 'TAX_ACCOUNTING' },
    });
    if (
      !(await tx.firmApplication.findUnique({ where: { id: SEED_PLATFORM_IDS.lvpApplication } }))
    ) {
      await tx.firmApplication.create({
        data: {
          id: SEED_PLATFORM_IDS.lvpApplication,
          legalName: 'LVP Accounting & Taxes LLC (fake)',
          dbaName: SEED_BUSINESSES.lvp.name,
          contactName: SEED_USERS.lvpOwner.name,
          contactEmail: SEED_USERS.lvpOwner.email,
          data: { businessType: 'Tax and accounting firm' },
        },
      });
    }
  });
  await runInScope(prisma, { kind: 'admin', adminUserId: SEED_USERS.superAdmin.id }, async (tx) => {
    await tx.firmApplication.updateMany({
      where: { id: SEED_PLATFORM_IDS.lvpApplication, status: 'PENDING_REVIEW' },
      data: {
        status: 'APPROVED',
        reviewedByUserId: SEED_USERS.superAdmin.id,
        reviewedAt: new Date(),
        decisionReason: 'Sample approval for local development.',
      },
    });
    if (
      !(await tx.supportAccessGrant.findUnique({ where: { id: SEED_PLATFORM_IDS.supportRequest } }))
    ) {
      await tx.supportAccessGrant.create({
        data: {
          id: SEED_PLATFORM_IDS.supportRequest,
          businessId: businesses.lvp,
          adminUserId: SEED_USERS.superAdmin.id,
          reason: 'Sample request: help with the portal settings.',
        },
      });
    }
    if (!(await tx.auditLog.findUnique({ where: { id: SEED_PLATFORM_IDS.platformEvent } }))) {
      await tx.auditLog.create({
        data: {
          id: SEED_PLATFORM_IDS.platformEvent,
          actorUserId: SEED_USERS.superAdmin.id,
          action: 'firm_application.approved',
          entityType: 'firm_application',
          entityId: SEED_PLATFORM_IDS.lvpApplication,
        },
      });
    }
  });
  await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.firmApplication.updateMany({
      where: { id: SEED_PLATFORM_IDS.lvpApplication, businessId: null },
      data: { businessId: businesses.lvp },
    }),
  );
  // The activation link Firmivra sent LVP's owner on approval, sent in platform scope (so the
  // database marks it and the Super Admin sees a copy) and already accepted.
  const lvpOwnerMembership = await runInScope(
    prisma,
    { kind: 'business', businessId: businesses.lvp },
    (tx) =>
      tx.membership.findUniqueOrThrow({
        where: {
          businessId_userId: { businessId: businesses.lvp, userId: SEED_USERS.lvpOwner.id },
        },
        select: { id: true },
      }),
  );
  const ownerInviteSent = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    if (await tx.invite.findUnique({ where: { id: SEED_OWNER_INVITE_ID } })) return false;
    await tx.invite.create({
      data: {
        id: SEED_OWNER_INVITE_ID,
        businessId: businesses.lvp,
        membershipId: lvpOwnerMembership.id,
        // Random and never printed; the link was used long ago.
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return true;
  });
  if (ownerInviteSent) {
    // The owner accepted it (activation, in the firm's scope).
    await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, (tx) =>
      tx.invite.update({ where: { id: SEED_OWNER_INVITE_ID }, data: { acceptedAt: new Date() } }),
    );
  }
  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, async (tx) => {
    if (!(await tx.auditLog.findUnique({ where: { id: SEED_PLATFORM_IDS.firmEvent } }))) {
      await tx.auditLog.create({
        data: {
          id: SEED_PLATFORM_IDS.firmEvent,
          businessId: businesses.lvp,
          actorUserId: SEED_USERS.lvpOwner.id,
          action: 'client_account.approved',
          entityType: 'client_account',
        },
      });
    }
  });

  // The client's private note: written as the client, the only one the database shows it to.
  await runInScope(
    prisma,
    { kind: 'business', businessId: businesses.lvp, actorUserId: SEED_USERS.lvpClient.id },
    async (tx) => {
      const owner = { businessId: businesses.lvp, userId: SEED_USERS.lvpClient.id };
      if (
        !(await tx.clientPrivateNote.findUnique({ where: { id: SEED_MESSAGE_IDS.clientNote } }))
      ) {
        await tx.clientPrivateNote.create({
          data: {
            ...owner,
            id: SEED_MESSAGE_IDS.clientNote,
            body: 'Remember to gather my 1099 forms. Ask about retirement contribution options.',
          },
        });
      }
      await tx.clientNoteReminder.upsert({
        where: { id: SEED_MESSAGE_IDS.clientNoteReminder },
        update: {},
        create: {
          ...owner,
          id: SEED_MESSAGE_IDS.clientNoteReminder,
          noteId: SEED_MESSAGE_IDS.clientNote,
          remindAt: new Date('2026-10-25T13:00:00Z'),
        },
      });
    },
  );

  await runInScope(prisma, { kind: 'business', businessId: businesses.testFirmB }, async (tx) => {
    await tx.membership.upsert({
      where: {
        businessId_userId: { businessId: businesses.testFirmB, userId: SEED_USERS.firmBOwner.id },
      },
      update: { role: 'OWNER', status: 'ACTIVE' },
      create: {
        businessId: businesses.testFirmB,
        userId: SEED_USERS.firmBOwner.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    await tx.clientAccount.upsert({
      where: { userId: SEED_USERS.firmBClient.id },
      update: { status: 'ACTIVE' },
      create: {
        businessId: businesses.testFirmB,
        userId: SEED_USERS.firmBClient.id,
        email: SEED_USERS.firmBClient.email,
        status: 'ACTIVE',
      },
    });
    await seedFirmBasics(tx, businesses.testFirmB, {
      name: SEED_BUSINESSES.testFirmB.name,
      ownerId: SEED_USERS.firmBOwner.id,
      contactEmail: 'hello@firm-b.test',
      taxStatuses: SEED_TAX_STATUSES.testFirmB,
    });
    await seedClient(
      tx,
      businesses.testFirmB,
      SEED_CLIENT_IDS.testFirmB,
      SEED_USERS.firmBClient,
      SEED_USERS.firmBOwner.id,
    );
    await seedDocumentCategories(tx, businesses.testFirmB, SEED_DOCUMENT_CATEGORIES.testFirmB);
    const service = await seedServices(tx, businesses.testFirmB, SEED_SERVICES.testFirmB);
    await seedIntakeForms(tx, businesses.testFirmB, service, ['Annual Tax']);
    await seedAppointmentTypes(tx, businesses.testFirmB, SEED_APPOINTMENT_TYPES.testFirmB);
    await tx.engagement.upsert({
      where: { id: SEED_WORK_IDS.firmBTax },
      update: {},
      create: {
        id: SEED_WORK_IDS.firmBTax,
        businessId: businesses.testFirmB,
        clientId: SEED_CLIENT_IDS.testFirmB,
        serviceId: service('Annual Tax'),
        title: '2025 Personal Tax',
        taxYear: 2025,
        stage: 'New',
      },
    });
  });

  console.warn(
    `Seeded: Super Admin, ${SEED_BUSINESSES.lvp.name} (owner, staff, invited staff, client), ${SEED_BUSINESSES.testFirmB.name} (owner, client), with settings, Terms, Privacy, tax statuses, clients, services, engagements, documents, intake forms, a Begin Online lead, notifications, a calendar, messages, invoices, content, a calculator, an approved firm application, a support request and sample audit events.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
