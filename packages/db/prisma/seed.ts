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
  SEED_STAFF_GROUP_IDS,
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
  SEED_LVP_APPLICATION_FORM,
  SEED_LVP_APPLICATION_OLD_DATA,
  SEED_MEETING_URLS,
  SEED_AGREEMENT_IDS,
  SAMPLE_AGREEMENT,
  SEED_ESIGN_IDS,
  SAMPLE_ESIGN_CONSENT,
} from './seed-data.js';
import {
  seedAppointmentTypes,
  seedClient,
  seedDocumentCategories,
  seedFirmAgreement,
  seedFirmBasics,
  seedIntakeForms,
  seedServices,
} from './seed-helpers.js';
import { seedR36 } from './seed-r36.js';
import { seedR37 } from './seed-r37.js';
import { seedR39 } from './seed-r39.js';
import { seedWorkModules } from './seed-r38.js';
import { seedPlatformPlans } from './seed-platform-plans.js';
import { seedPlatformTeam } from './seed-platform-team.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
// The seed runs a few large transactions, sometimes next to the test suites (seed.test.ts): give
// them time to start and finish.
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

const hex = (label: string) => createHash('sha256').update(label).digest('hex');
/** Never a usable link, code or upload token: only a hash of random bytes is stored. */
const randomHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');

/**
 * Firm Sign for LVP (r0_esign): the module on (with calculators), settings, consent v1, a
 * Manager with a job title, a template, and one request sent from it to the client, approved by
 * the owner, with its link, email code, outbox row, events, a pending attachment, a kiosk lock
 * (on the invited member, so no one who signs in is locked) and the bulk batch that made it.
 * Synthetic data only; created once (the request is never re-created).
 */
async function seedEsign(tx: TxClient, businessId: string) {
  const ids = SEED_ESIGN_IDS;
  const firm = { businessId };
  for (const module of ['esign', 'calculators']) {
    await tx.$queryRaw`SELECT app_set_business_module(${businessId}::uuid, ${module}, true, 'Seed: local development')`;
  }
  await tx.esignSettings.upsert({ where: { businessId }, update: {}, create: firm });
  await tx.esignConsentVersion.upsert({
    where: { businessId_version: { businessId, version: 1 } },
    update: {},
    create: {
      ...firm,
      version: 1,
      bodyMarkdown: SAMPLE_ESIGN_CONSENT,
      sha256: hex(SAMPLE_ESIGN_CONSENT),
      publishedByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  const staff = SEED_USERS.lvpStaff.id;
  await tx.esignMemberRole.upsert({
    where: { businessId_userId: { businessId, userId: staff } },
    update: {},
    create: { ...firm, userId: staff, role: 'MANAGER' },
  });
  await tx.membership.update({
    where: { businessId_userId: { businessId, userId: staff } },
    data: { jobTitle: 'Tax Preparer' },
  });
  if (await tx.esignRequest.findUnique({ where: { id: ids.request } })) return;

  const settings = {
    routing: 'SEQUENTIAL' as const,
    expiryDays: 30,
    reminderFirstAfterDays: 3,
    reminderEveryDays: 3,
    reminderMax: 3,
    expiryWarningDays: 2,
  };
  const pageSizes = [{ width: 612, height: 792 }];
  const packet = hex('Seed engagement letter');
  await tx.esignTemplate.create({
    data: {
      ...firm,
      id: ids.template,
      name: 'Engagement letter',
      visibility: 'FIRM',
      ownerUserId: staff,
    },
  });
  await tx.esignTemplateVersion.create({
    data: {
      ...firm,
      templateId: ids.template,
      version: 1,
      s3Key: `tenant/${businessId}/esign/${ids.template}/template-${packet}.pdf`,
      sha256: packet,
      sizeBytes: 24000,
      pageSizes,
      roles: [
        {
          key: 'client',
          kind: 'SIGNER',
          role: 'CLIENT',
          roleLabel: null,
          routingOrder: 1,
          authMethod: 'EMAIL_CODE',
          colorIndex: 0,
        },
      ],
      fields: [],
      ...settings,
      savedByUserId: staff,
    },
  });

  const login = await tx.clientAccount.findUniqueOrThrow({
    where: { userId: SEED_USERS.lvpClient.id },
  });
  const request = { ...firm, requestId: ids.request };
  await tx.esignRequest.create({
    data: {
      ...firm,
      id: ids.request,
      title: '2025 engagement letter',
      source: 'TEMPLATE',
      clientId: SEED_CLIENT_IDS.lvp,
      engagementId: SEED_WORK_IDS.lvpTax,
      senderUserId: staff,
      ...settings,
      pagePlan: [{ documentId: ids.document, page: 0, rotation: 0 }],
      templateId: ids.template,
      templateVersion: 1,
    },
  });
  await tx.esignDocument.create({
    data: {
      ...request,
      id: ids.document,
      position: 0,
      fileName: 'Engagement letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: 24000,
      pageCount: 1,
      pageSizes,
      s3Key: `tenant/${businessId}/esign/${ids.request}/source/${ids.document}`,
      sha256: packet,
      scanStatus: 'CLEAN',
      scannedAt: new Date(),
    },
  });
  await tx.esignRecipient.createMany({
    data: [
      {
        ...request,
        id: ids.signer,
        position: 0,
        kind: 'SIGNER',
        role: 'CLIENT',
        routingOrder: 1,
        name: SEED_USERS.lvpClient.name,
        email: SEED_USERS.lvpClient.email,
        linkType: 'CLIENT_LOGIN',
        clientAccountId: login.id,
        delivery: 'EMAIL',
        authMethod: 'EMAIL_CODE',
        colorIndex: 0,
      },
      {
        ...request,
        id: ids.approver,
        position: 1,
        kind: 'APPROVER',
        role: 'MANAGER',
        routingOrder: 1,
        name: SEED_USERS.lvpOwner.name,
        email: SEED_USERS.lvpOwner.email,
        linkType: 'STAFF',
        staffUserId: SEED_USERS.lvpOwner.id,
        delivery: 'EMAIL',
        authMethod: 'LINK',
        colorIndex: 1,
        status: 'APPROVED',
      },
    ],
  });
  const box = { pageIndex: 0, required: true, w: 0.3, h: 0.05, x: 0.1 };
  await tx.esignField.createMany({
    data: [
      {
        ...request,
        ...box,
        id: ids.signatureField,
        recipientId: ids.signer,
        position: 0,
        type: 'SIGNATURE',
        y: 0.8,
      },
      {
        ...request,
        ...box,
        id: ids.attachmentField,
        recipientId: ids.signer,
        position: 1,
        type: 'ATTACHMENT',
        y: 0.6,
        label: 'Photo ID',
      },
    ],
  });
  await tx.esignApprovalNote.create({
    data: { ...request, recipientId: ids.approver, decision: 'APPROVE', note: 'Looks good.' },
  });

  const sentAt = new Date();
  await tx.esignRequest.update({
    where: { id: ids.request },
    data: {
      status: 'SENT',
      sentAt,
      expiresAt: new Date(sentAt.getTime() + 30 * 86_400_000),
      originalSha256: packet,
      lastActivityAt: sentAt,
    },
  });
  await tx.esignRecipient.update({ where: { id: ids.signer }, data: { status: 'SENT', sentAt } });
  const staffName = SEED_USERS.lvpStaff.name;
  await tx.esignEvent.createMany({
    data: [
      { ...request, type: 'CREATED', actorKind: 'STAFF', actorUserId: staff, actorName: staffName },
      {
        ...request,
        type: 'APPROVED',
        actorKind: 'STAFF',
        actorUserId: SEED_USERS.lvpOwner.id,
        actorName: SEED_USERS.lvpOwner.name,
        recipientId: ids.approver,
        recipientName: SEED_USERS.lvpOwner.name,
      },
      { ...request, type: 'SENT', actorKind: 'STAFF', actorUserId: staff, actorName: staffName },
    ],
  });
  await tx.esignEmail.create({
    data: {
      ...request,
      recipientId: ids.signer,
      template: 'esign.request',
      status: 'SENT',
      attempts: 1,
      sentAt,
    },
  });
  await tx.esignSigningLink.create({
    data: {
      ...request,
      recipientId: ids.signer,
      tokenHash: randomHash(),
      tokenVersion: 0,
      purpose: 'SIGN',
    },
  });
  await tx.esignVerificationCode.create({
    data: {
      ...firm,
      recipientId: ids.signer,
      kind: 'EMAIL',
      codeHash: randomHash(),
      expiresAt: sentAt,
      sentTimes: [sentAt],
    },
  });
  const attachmentKey = (id: string) =>
    `tenant/${businessId}/esign/${ids.request}/attachments/${id}`;
  const file = { contentType: 'image/jpeg', sizeBytes: 50000, sha256: hex('Seed photo ID') };
  await tx.esignAttachment.create({
    data: {
      ...request,
      ...file,
      id: ids.attachment,
      recipientId: ids.signer,
      fieldId: ids.attachmentField,
      s3Key: attachmentKey(ids.attachment),
      fileName: 'photo-id.jpg',
    },
  });
  await tx.esignPendingUpload.create({
    data: {
      ...request,
      ...file,
      tokenHash: randomHash(),
      kind: 'ATTACHMENT',
      recipientId: ids.signer,
      fieldId: ids.attachmentField,
      fileId: ids.pendingAttachment,
      s3Key: attachmentKey(ids.pendingAttachment),
      fileName: 'photo-id-back.jpg',
    },
  });
  await tx.esignKioskLock.create({
    data: {
      ...request,
      userId: SEED_USERS.lvpInvited.id,
      recipientId: ids.signer,
      signerName: SEED_USERS.lvpClient.name,
      linkExpiresAt: new Date(sentAt.getTime() + 15 * 60_000),
    },
  });
  await tx.esignBulkBatch.create({
    data: {
      ...firm,
      id: ids.batch,
      templateId: ids.template,
      templateVersion: 1,
      templateName: 'Engagement letter',
      createdByUserId: staff,
    },
  });
  await tx.esignBulkItem.create({
    data: {
      ...firm,
      batchId: ids.batch,
      position: 0,
      clientId: SEED_CLIENT_IDS.lvp,
      engagementId: SEED_WORK_IDS.lvpTax,
      requestId: ids.request,
      created: true,
      state: 'SENT',
    },
  });
}

/** Test Firm B: Firm Sign off, with one DRAFT request (for isolation tests). */
async function seedEsignDraft(tx: TxClient, businessId: string) {
  await tx.esignRequest.upsert({
    where: { id: SEED_ESIGN_IDS.firmBRequest },
    update: {},
    create: {
      businessId,
      id: SEED_ESIGN_IDS.firmBRequest,
      title: 'Firm B draft',
      source: 'TAB',
      clientId: SEED_CLIENT_IDS.testFirmB,
      senderUserId: SEED_USERS.firmBOwner.id,
      routing: 'PARALLEL',
      expiryDays: 30,
      reminderFirstAfterDays: 3,
      reminderEveryDays: 3,
      reminderMax: 3,
      expiryWarningDays: 2,
    },
  });
}

/** Stage B6: Firmivra's communications with LVP (see main). Idempotent by fixed ids. */
async function seedCommunications(lvp: string) {
  const ids = SEED_PLATFORM_IDS;
  const owner = SEED_USERS.lvpOwner;
  const asAdmin = { kind: 'admin', adminUserId: SEED_USERS.superAdmin.id } as const;
  if (
    await runInScope(prisma, asAdmin, (tx) =>
      tx.commConversation.findUnique({ where: { id: ids.commConversation } }),
    )
  ) {
    return;
  }
  await runInScope(prisma, asAdmin, async (tx) => {
    const onboarding = await tx.commTemplateCategory.findUniqueOrThrow({
      where: { systemKey: 'onboarding' },
    });
    await tx.commMedia.create({
      data: {
        id: ids.commImage,
        kind: 'INLINE_IMAGE',
        fileName: 'firmivra-logo.png',
        contentType: 'image/png',
        sizeBytes: 18_432,
        sha256: createHash('sha256').update('firmivra-logo.png').digest('hex'),
        s3Key: `platform/communications/${ids.commImage}/firmivra-logo.png`,
      },
    });
    await tx.commTemplate.create({
      data: {
        id: ids.commTemplate,
        categoryId: onboarding.id,
        name: 'Welcome to Firmivra',
        channel: 'EMAIL',
        subject: 'Welcome to Firmivra, {{firm.name}}',
        body: '<p>Hi {{contact.first_name}},</p><p>Your workspace is ready. Your onboarding call is on {{onboarding.call_date}}.</p>',
        mergeFields: ['firm.name', 'contact.first_name', 'onboarding.call_date'],
      },
    });
    await tx.commConversation.create({
      data: {
        id: ids.commConversation,
        contactType: 'FIRM',
        linkedBusinessId: lvp,
        contactUserId: owner.id,
        contactName: owner.name,
        contactEmail: owner.email,
        subject: 'Welcome to Firmivra',
        assignedToUserId: SEED_USERS.superAdmin.id,
        tags: ['onboarding'],
      },
    });
    await tx.commMessage.create({
      data: {
        id: ids.commWelcome,
        conversationId: ids.commConversation,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        subject: `Welcome to Firmivra, ${SEED_BUSINESSES.lvp.name}`,
        body: '<p>Your workspace is ready. Your onboarding call is on Tuesday at 10:00.</p>',
        templateId: ids.commTemplate,
        recipients: {
          create: [
            {
              contactType: 'FIRM',
              linkedBusinessId: lvp,
              contactUserId: owner.id,
              name: owner.name,
              address: owner.email,
            },
          ],
        },
      },
    });
    // Send now: written as a draft with its recipients, then handed to the dispatcher.
    await tx.commMessage.update({ where: { id: ids.commWelcome }, data: { status: 'SENDING' } });
    await tx.commSegment.create({
      data: {
        id: ids.commSegment,
        name: 'Active firms on Team Pro',
        definition: { contactTypes: ['FIRM'], firmStatuses: ['ACTIVE'], planCodes: ['TEAM_PRO'] },
        lastCount: 1,
      },
    });
    await tx.commBroadcast.create({
      data: {
        id: ids.commBroadcast,
        name: 'October product update',
        segmentId: ids.commSegment,
        recipientCount: 1,
        channels: {
          create: [
            {
              channel: 'EMAIL',
              subject: 'What is new in Firmivra this October',
              body: '<p>Firm Sign is live for every plan, and the client portal has a new look.</p>',
            },
          ],
        },
      },
    });
    await tx.commBroadcast.update({
      where: { id: ids.commBroadcast },
      data: { status: 'SENDING' },
    });
  });
  // The dispatcher and the inbound mailbox (platform scope).
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    await tx.commMedia.update({ where: { id: ids.commImage }, data: { scanStatus: 'CLEAN' } });
    await tx.commMessageRecipient.updateMany({
      where: { messageId: ids.commWelcome },
      data: { status: 'SENT', providerMessageId: 'seed-ses-0001' },
    });
    await tx.commMessage.update({ where: { id: ids.commWelcome }, data: { status: 'SENT' } });
    await tx.commMessage.create({
      data: {
        id: ids.commReply,
        conversationId: ids.commConversation,
        channel: 'EMAIL',
        direction: 'INBOUND',
        status: 'RECEIVED',
        subject: 'Re: Welcome to Firmivra',
        body: 'Thanks! Tuesday works. Can two of my preparers join the call?',
        fromAddress: owner.email,
      },
    });
    const recipient = await tx.commBroadcastRecipient.create({
      data: {
        broadcastId: ids.commBroadcast,
        channel: 'EMAIL',
        contactType: 'FIRM',
        linkedBusinessId: lvp,
        contactUserId: owner.id,
        name: owner.name,
        address: owner.email,
      },
    });
    await tx.commBroadcastRecipient.update({
      where: { id: recipient.id },
      data: { status: 'SENT', providerMessageId: 'seed-ses-0002' },
    });
    await tx.commBroadcastChannel.updateMany({
      where: { broadcastId: ids.commBroadcast },
      data: { status: 'SENDING' },
    });
    await tx.commBroadcastChannel.updateMany({
      where: { broadcastId: ids.commBroadcast },
      data: { status: 'SENT', sentCount: 1 },
    });
    await tx.commBroadcast.update({ where: { id: ids.commBroadcast }, data: { status: 'SENT' } });
  });
  // The team's internal note, mentioning the Super Admin, and their read mark.
  await runInScope(prisma, asAdmin, async (tx) => {
    await tx.commMessage.create({
      data: {
        id: ids.commNote,
        conversationId: ids.commConversation,
        channel: 'INTERNAL',
        direction: 'INTERNAL',
        status: 'SENT',
        body: 'Owner asked to bring two preparers to the onboarding call. Send them the guest link.',
        mentions: { create: [{ userId: SEED_USERS.superAdmin.id }] },
      },
    });
    await tx.commMediaLink.create({
      data: { mediaId: ids.commImage, usage: 'INLINE_IMAGE', templateId: ids.commTemplate },
    });
    await tx.commConversationRead.create({
      data: {
        conversationId: ids.commConversation,
        userId: SEED_USERS.superAdmin.id,
        lastReadAt: new Date(),
      },
    });
  });
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
    for (const [user, role, meetingUrl] of [
      [SEED_USERS.lvpOwner, 'OWNER', SEED_MEETING_URLS.lvpOwner],
      [SEED_USERS.lvpStaff, 'STAFF', SEED_MEETING_URLS.lvpStaff],
    ] as const) {
      await tx.membership.upsert({
        where: { businessId_userId: { businessId: businesses.lvp, userId: user.id } },
        update: { role, status: 'ACTIVE', meetingUrl },
        create: { businessId: businesses.lvp, userId: user.id, role, status: 'ACTIVE', meetingUrl },
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
    await seedFirmAgreement(tx, businesses.lvp, SEED_USERS.lvpOwner.id, SEED_AGREEMENT_IDS.lvp);

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

    // One department headed by the owner, with a team led by the staff member.
    const lvpMembers = await tx.membership.findMany({
      where: { userId: { in: [SEED_USERS.lvpOwner.id, SEED_USERS.lvpStaff.id] } },
      select: { id: true, userId: true },
    });
    const memberOf = (userId: string) => lvpMembers.find((m) => m.userId === userId)!.id;
    await tx.department.upsert({
      where: { id: SEED_STAFF_GROUP_IDS.department },
      update: {},
      create: {
        id: SEED_STAFF_GROUP_IDS.department,
        businessId: businesses.lvp,
        name: 'Tax',
        description: 'Individual and business tax preparation and planning.',
        headMembershipId: memberOf(SEED_USERS.lvpOwner.id),
      },
    });
    await tx.team.upsert({
      where: { id: SEED_STAFF_GROUP_IDS.team },
      update: {},
      create: {
        id: SEED_STAFF_GROUP_IDS.team,
        businessId: businesses.lvp,
        departmentId: SEED_STAFF_GROUP_IDS.department,
        name: 'Individual Tax',
        leadMembershipId: memberOf(SEED_USERS.lvpStaff.id),
      },
    });
    await tx.teamMember.upsert({
      where: {
        teamId_membershipId: {
          teamId: SEED_STAFF_GROUP_IDS.team,
          membershipId: memberOf(SEED_USERS.lvpStaff.id),
        },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        teamId: SEED_STAFF_GROUP_IDS.team,
        membershipId: memberOf(SEED_USERS.lvpStaff.id),
        kind: 'PRIMARY',
      },
    });
    await tx.memberDepartment.upsert({
      where: {
        membershipId_departmentId: {
          membershipId: memberOf(SEED_USERS.lvpStaff.id),
          departmentId: SEED_STAFF_GROUP_IDS.department,
        },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        membershipId: memberOf(SEED_USERS.lvpStaff.id),
        departmentId: SEED_STAFF_GROUP_IDS.department,
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
        // The real Annual Tax form's own questions, partly answered (an IN_PROGRESS intake).
        answers: { firstName: 'Chris', lastName: 'Client' },
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
        taxYear: 2025,
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
    // A submitted version is locked (even an empty upsert would update it), so create it once:
    // a draft, the signature evidence for LVP's firm-wide v1, then the submit that copies the
    // signature's name, database time, IP and browser. Signing and submitting share this
    // transaction, as the database requires.
    let signedAt = new Date();
    if (
      !(await tx.intakeSubmission.findUnique({ where: { id: SEED_INTAKE_IDS.leadSubmission } }))
    ) {
      const answers = { fullName: 'Lena Lead (fake)' };
      await tx.intakeSubmission.create({
        data: {
          ...lvp,
          id: SEED_INTAKE_IDS.leadSubmission,
          intakeId: SEED_INTAKE_IDS.leadIntake,
          version: 1,
          answers,
        },
      });
      const version = await tx.firmAgreementVersion.findUniqueOrThrow({
        where: { id: SEED_AGREEMENT_IDS.lvp.version },
      });
      const sha = (value: unknown) =>
        createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const signature = await tx.intakeSignature.create({
        data: {
          ...lvp,
          id: SEED_AGREEMENT_IDS.leadSignature,
          submissionId: SEED_INTAKE_IDS.leadSubmission,
          intakeId: SEED_INTAKE_IDS.leadIntake,
          leadId: SEED_INTAKE_IDS.lead,
          printedName: 'Lena Lead (fake)',
          signatureText: 'Lena Lead (fake)',
          signerEmail: 'lena.lead@begin.test',
          acknowledgments: SAMPLE_AGREEMENT.acknowledgments.map((a) => ({
            agreementVersionId: version.id,
            ...a,
            checked: true,
          })),
          // The database replaces this with the hash of the stored answers.
          answersSha256: sha(answers),
          evidenceSha256: sha({ seed: SEED_AGREEMENT_IDS.leadSignature }),
          ip: '203.0.113.10',
          userAgent: 'Sample browser (seed)',
          agreements: {
            create: {
              agreementVersionId: version.id,
              bodySha256: version.bodySha256,
              pdfSha256: version.pdfSha256,
            },
          },
        },
      });
      signedAt = signature.signedAt;
      await tx.intakeSubmission.update({
        where: { id: SEED_INTAKE_IDS.leadSubmission },
        data: {
          submittedAt: signedAt,
          signerName: signature.printedName,
          signedAt,
          signerIp: signature.ip,
          signerUserAgent: signature.userAgent,
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
    // The VIDEO appointment carries its staff member's own meeting link.
    await tx.appointment.upsert({
      where: { id: SEED_CALENDAR_IDS.appointment },
      update: { locationDetails: SEED_MEETING_URLS.lvpStaff },
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
        locationDetails: SEED_MEETING_URLS.lvpStaff,
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

  // Staff details and security for LVP's two members, and one saved Create Staff draft. Pay
  // details are written as the acting owner: the database shows them to no one else.
  await runInScope(
    prisma,
    { kind: 'business', businessId: businesses.lvp, actorUserId: SEED_USERS.lvpOwner.id },
    async (tx) => {
      const members = await tx.membership.findMany({
        where: { userId: { in: [SEED_USERS.lvpOwner.id, SEED_USERS.lvpStaff.id] } },
        select: { id: true, userId: true },
      });
      const ownerId = members.find((m) => m.userId === SEED_USERS.lvpOwner.id)!.id;
      const staffId = members.find((m) => m.userId === SEED_USERS.lvpStaff.id)!.id;
      const businessId = businesses.lvp;
      for (const [membershipId, profile] of [
        [
          ownerId,
          {
            employmentType: 'W2',
            office: 'Main office',
            accessLevel: 'ADMINISTRATOR',
            supervisorId: null,
            timeZone: 'America/New_York',
            employeeId: 'EMP001',
            serviceAreas: [],
            maxWorkload: null,
          },
        ],
        [
          staffId,
          {
            employmentType: 'FULL_TIME',
            office: 'Main office',
            supervisorId: ownerId,
            timeZone: 'America/New_York',
            employeeId: 'EMP002',
            serviceAreas: ['TAX_PREPARATION'],
            maxWorkload: 50,
          },
        ],
      ] as const) {
        await tx.staffProfile.upsert({
          where: { businessId_membershipId: { businessId, membershipId } },
          update: {},
          create: { businessId, membershipId, ...profile, serviceAreas: [...profile.serviceAreas] },
        });
        await tx.staffSecuritySettings.upsert({
          where: { businessId_membershipId: { businessId, membershipId } },
          update: {},
          create: { businessId, membershipId, autoLogoutMinutes: 30 },
        });
      }
      await tx.staffCompensation.upsert({
        where: { businessId_membershipId: { businessId, membershipId: staffId } },
        update: {},
        create: {
          businessId,
          membershipId: staffId,
          payType: 'SALARY',
          rateCents: 6_000_000n,
          payFrequency: 'MONTHLY',
          payrollId: 'PR002',
        },
      });
      await tx.staffDocument.upsert({
        where: { id: SEED_STAFF_GROUP_IDS.document },
        update: {},
        create: {
          id: SEED_STAFF_GROUP_IDS.document,
          businessId,
          membershipId: staffId,
          type: 'EMPLOYMENT_AGREEMENT',
          fileName: 'seed-employment-agreement.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
          sha256: createHash('sha256').update('seed-employment-agreement').digest('hex'),
          s3Key: `tenant/${businessId}/staff/${staffId}/seed-employment-agreement.pdf`,
          uploadedById: ownerId,
        },
      });
      await tx.staffSession.upsert({
        where: { id: SEED_STAFF_GROUP_IDS.session },
        update: {},
        create: {
          id: SEED_STAFF_GROUP_IDS.session,
          businessId,
          membershipId: staffId,
          tokenHash: createHash('sha256').update('seed-staff-session').digest('hex'),
          device: 'Chrome on macOS',
          ip: '203.0.113.7',
          place: 'Atlanta, GA, USA',
        },
      });
      await tx.rolePermission.upsert({
        where: {
          businessId_role_module_capability: {
            businessId,
            role: 'BOOKKEEPER',
            module: 'PAYROLL',
            capability: 'VIEW',
          },
        },
        update: {},
        create: {
          businessId,
          role: 'BOOKKEEPER',
          module: 'PAYROLL',
          capability: 'VIEW',
          granted: true,
          updatedById: ownerId,
        },
      });
      await tx.memberPermission.upsert({
        where: {
          businessId_membershipId_module_capability: {
            businessId,
            membershipId: staffId,
            module: 'REPORTS',
            capability: 'EXPORT',
          },
        },
        update: {},
        create: {
          businessId,
          membershipId: staffId,
          module: 'REPORTS',
          capability: 'EXPORT',
          granted: true,
          updatedById: ownerId,
        },
      });
      await tx.staffDraft.upsert({
        where: { id: SEED_STAFF_GROUP_IDS.draft },
        update: {},
        create: {
          id: SEED_STAFF_GROUP_IDS.draft,
          businessId,
          createdById: ownerId,
          step: 2,
          data: { firstName: 'Jordan', lastName: 'Example', role: 'BOOKKEEPER' },
        },
      });
    },
  );

  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, (tx) =>
    seedEsign(tx, businesses.lvp),
  );
  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, (tx) =>
    seedR39(tx, businesses.lvp),
  );

  // The work modules (Tasks, Compliance, Automations, Bookkeeping, Tax Planning), after the rows
  // they point at.
  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, async (tx) => {
    const services = await tx.service.findMany({
      where: { businessId: businesses.lvp },
      select: { id: true, name: true },
    });
    const serviceId = (name: string) => services.find((x) => x.name === name)!.id;
    await seedWorkModules(tx, {
      businessId: businesses.lvp,
      clientId: SEED_CLIENT_IDS.lvp,
      ownerId: SEED_USERS.lvpOwner.id,
      staffId: SEED_USERS.lvpStaff.id,
      taskId: SEED_WORK_IDS.lvpTask,
      taxEngagementId: SEED_WORK_IDS.lvpTax,
      bookkeepingEngagementId: SEED_WORK_IDS.lvpBookkeeping,
      taxServiceId: serviceId('Annual Tax'),
      bookkeepingServiceId: serviceId('Bookkeeping'),
      documentId: SEED_DOCUMENT_IDS.interestDocument,
      reportId: SEED_WORK_IDS.lvpReport,
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
    const form = SEED_LVP_APPLICATION_FORM;
    if (
      !(await tx.firmApplication.findUnique({ where: { id: SEED_PLATFORM_IDS.lvpApplication } }))
    ) {
      await tx.firmApplication.create({
        data: {
          id: SEED_PLATFORM_IDS.lvpApplication,
          legalName: form.business.legalName,
          dbaName: form.business.dbaName,
          contactName: form.primaryAdmin.fullName,
          contactEmail: form.primaryAdmin.email,
          contactPhone: form.primaryAdmin.phone,
          data: form,
        },
      });
    }
    // A database seeded before the stored form: the review page can't read its old data.
    await tx.firmApplication.updateMany({
      where: {
        id: SEED_PLATFORM_IDS.lvpApplication,
        data: { equals: SEED_LVP_APPLICATION_OLD_DATA },
      },
      data: { data: form, contactPhone: form.primaryAdmin.phone },
    });
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
    // Stage B1: the Super Admin's bell item for the approval, and an audit export they asked for.
    if (
      !(await tx.platformNotification.findUnique({ where: { id: SEED_PLATFORM_IDS.notification } }))
    ) {
      await tx.platformNotification.create({
        data: {
          id: SEED_PLATFORM_IDS.notification,
          recipientUserId: SEED_USERS.superAdmin.id,
          category: 'FIRM_APPLICATIONS',
          type: 'firm_application.approved',
          priority: 'NORMAL',
          title: 'Firm application approved',
          body: 'LVP Accounting & Taxes was approved and its owner was invited.',
          sourceType: 'firm_application',
          sourceId: SEED_PLATFORM_IDS.lvpApplication,
          sourceLabel: SEED_BUSINESSES.lvp.name,
          businessId: businesses.lvp,
          eventKey: `firm_application.approved:${SEED_PLATFORM_IDS.lvpApplication}`,
        },
      });
    }
    if (!(await tx.platformExportJob.findUnique({ where: { id: SEED_PLATFORM_IDS.exportJob } }))) {
      await tx.platformExportJob.create({
        data: {
          id: SEED_PLATFORM_IDS.exportJob,
          requestedByUserId: SEED_USERS.superAdmin.id,
          module: 'AUDIT',
          format: 'CSV',
          title: 'Audit events, last 30 days',
          filters: { range: 'LAST_30_DAYS' },
          columns: ['occurredAt', 'actor', 'action', 'firm'],
        },
      });
    }
    // Stage B2: LVP's ticket with Firmivra support, as the team works it (admin scope): raised by
    // email about LVP's owner, assigned, answered with a screenshot, with a note and its history.
    if (!(await tx.supportTicket.findUnique({ where: { id: SEED_PLATFORM_IDS.supportTicket } }))) {
      const category = await tx.supportCategory.findUniqueOrThrow({
        where: { name: 'Account Access' },
      });
      const priority = await tx.supportPriority.findUniqueOrThrow({ where: { code: 'HIGH' } });
      await tx.supportTicket.create({
        data: {
          id: SEED_PLATFORM_IDS.supportTicket,
          businessId: businesses.lvp,
          contactUserId: SEED_USERS.lvpOwner.id,
          subject: 'Staff member cannot finish MFA setup',
          description:
            'Our new preparer gets "code expired" every time she scans the QR code. Can you help?',
          categoryId: category.id,
          priorityId: priority.id,
          source: 'EMAIL',
          assignedUserId: SEED_USERS.superAdmin.id,
          createdByUserId: SEED_USERS.superAdmin.id,
        },
      });
      await tx.supportTicketMessage.create({
        data: {
          id: SEED_PLATFORM_IDS.supportStaffReply,
          businessId: businesses.lvp,
          ticketId: SEED_PLATFORM_IDS.supportTicket,
          authorUserId: SEED_USERS.superAdmin.id,
          authorSide: 'STAFF',
          body: 'Thanks for reaching out. Her phone clock looks out of sync; the screenshot shows where to turn on automatic time.',
          deliveryChannel: 'EMAIL',
        },
      });
      await tx.supportTicketAttachment.create({
        data: {
          id: SEED_PLATFORM_IDS.supportAttachment,
          businessId: businesses.lvp,
          ticketId: SEED_PLATFORM_IDS.supportTicket,
          messageId: SEED_PLATFORM_IDS.supportStaffReply,
          uploadedByUserId: SEED_USERS.superAdmin.id,
          fileName: 'automatic-time-setting.png',
          contentType: 'image/png',
          sizeBytes: 84213,
          sha256: createHash('sha256').update('sample support screenshot').digest('hex'),
          s3Key: `tenant/${businesses.lvp}/support/${SEED_PLATFORM_IDS.supportAttachment}`,
        },
      });
      await tx.supportTicketNote.create({
        data: {
          id: SEED_PLATFORM_IDS.supportNote,
          businessId: businesses.lvp,
          ticketId: SEED_PLATFORM_IDS.supportTicket,
          authorUserId: SEED_USERS.superAdmin.id,
          body: 'Third clock-drift case this month; worth a help article.',
        },
      });
      await tx.supportTicketEvent.create({
        data: {
          id: SEED_PLATFORM_IDS.supportEvent,
          businessId: businesses.lvp,
          ticketId: SEED_PLATFORM_IDS.supportTicket,
          actorUserId: SEED_USERS.superAdmin.id,
          actorType: 'USER',
          action: 'ticket.assigned',
          newValue: SEED_USERS.superAdmin.name,
        },
      });
      await tx.supportTicket.update({
        where: { id: SEED_PLATFORM_IDS.supportTicket },
        data: { status: 'WAITING_ON_CUSTOMER', firstRespondedAt: new Date() },
      });
    }
    await tx.supportHoliday.upsert({
      where: { id: SEED_PLATFORM_IDS.supportHoliday },
      update: {},
      create: {
        id: SEED_PLATFORM_IDS.supportHoliday,
        date: new Date('2026-11-26'),
        name: 'Thanksgiving',
      },
    });
    await tx.supportCannedResponse.upsert({
      where: { id: SEED_PLATFORM_IDS.supportCannedResponse },
      update: {},
      create: {
        id: SEED_PLATFORM_IDS.supportCannedResponse,
        title: 'MFA code expired',
        body: 'An "expired" code usually means the phone clock is off. Turn on automatic date and time, then scan the code again.',
        createdByUserId: SEED_USERS.superAdmin.id,
      },
    });
    // Stage B3: what Firmivra billed LVP (admin scope). The database numbers the documents, works
    // out the totals and keeps the paid, refunded and credited sums and statuses.
    if (
      !(await tx.platformInvoice.findUnique({
        where: { id: SEED_PLATFORM_IDS.billingPaidInvoice },
      }))
    ) {
      const billTo = {
        billToName: SEED_USERS.lvpOwner.name,
        billToEmail: SEED_USERS.lvpOwner.email,
      };
      await tx.platformFirmBillingProfile.create({
        data: {
          businessId: businesses.lvp,
          billingContactName: billTo.billToName,
          billingContactEmail: billTo.billToEmail,
          paymentTermDays: 15,
        },
      });
      // September: Team Pro, paid by card, then $20 refunded as a goodwill credit.
      await tx.platformInvoice.create({
        data: {
          id: SEED_PLATFORM_IDS.billingPaidInvoice,
          businessId: businesses.lvp,
          invoiceDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-16'),
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          ...billTo,
          createdByUserId: SEED_USERS.superAdmin.id,
          lines: {
            create: [
              { description: 'Team Pro plan, September 2026', unitCents: 19900 },
              { description: 'Additional seat', quantity: 2, unitCents: 2900, sortOrder: 1 },
            ],
          },
        },
      });
      await tx.platformInvoice.update({
        where: { id: SEED_PLATFORM_IDS.billingPaidInvoice },
        data: { status: 'SENT' },
      });
      await tx.platformPayment.create({
        data: {
          id: SEED_PLATFORM_IDS.billingPayment,
          businessId: businesses.lvp,
          invoiceId: SEED_PLATFORM_IDS.billingPaidInvoice,
          amountCents: 25700,
          method: 'CARD',
          status: 'COMPLETED',
          paidOn: new Date('2026-09-03'),
          reference: 'Visa ending 4242',
          recordedByUserId: SEED_USERS.superAdmin.id,
          idempotencyKey: SEED_PLATFORM_IDS.billingPaymentKey,
        },
      });
      await tx.platformRefund.create({
        data: {
          id: SEED_PLATFORM_IDS.billingRefund,
          businessId: businesses.lvp,
          paymentId: SEED_PLATFORM_IDS.billingPayment,
          amountCents: 2000,
          reason: 'Goodwill credit for the September portal outage.',
          requestedByUserId: SEED_USERS.superAdmin.id,
        },
      });
      await tx.platformRefund.update({
        where: { id: SEED_PLATFORM_IDS.billingRefund },
        data: { status: 'COMPLETED' },
      });
      // October: sent, part settled by a $50 credit note.
      await tx.platformInvoice.create({
        data: {
          id: SEED_PLATFORM_IDS.billingCreditedInvoice,
          businessId: businesses.lvp,
          invoiceDate: new Date('2026-10-01'),
          dueDate: new Date('2026-10-16'),
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-10-31'),
          ...billTo,
          createdByUserId: SEED_USERS.superAdmin.id,
          lines: {
            create: [{ description: 'Team Pro plan, October 2026', unitCents: 19900 }],
          },
        },
      });
      await tx.platformInvoice.update({
        where: { id: SEED_PLATFORM_IDS.billingCreditedInvoice },
        data: { status: 'SENT' },
      });
      await tx.platformCreditNote.create({
        data: {
          id: SEED_PLATFORM_IDS.billingCreditNote,
          businessId: businesses.lvp,
          relatedInvoiceId: SEED_PLATFORM_IDS.billingPaidInvoice,
          issueDate: new Date('2026-10-02'),
          reason: 'Service credit for the September outage.',
          createdByUserId: SEED_USERS.superAdmin.id,
          lines: {
            create: [{ description: 'Service credit', unitCents: 5000 }],
          },
        },
      });
      await tx.platformCreditNote.update({
        where: { id: SEED_PLATFORM_IDS.billingCreditNote },
        data: { status: 'AVAILABLE' },
      });
      await tx.platformCreditApplication.create({
        data: {
          businessId: businesses.lvp,
          creditNoteId: SEED_PLATFORM_IDS.billingCreditNote,
          invoiceId: SEED_PLATFORM_IDS.billingCreditedInvoice,
          amountCents: 5000,
          appliedByUserId: SEED_USERS.superAdmin.id,
        },
      });
      // An upgrade quote, and the monthly schedule.
      await tx.platformEstimate.create({
        data: {
          id: SEED_PLATFORM_IDS.billingEstimate,
          businessId: businesses.lvp,
          issueDate: new Date('2026-10-05'),
          expirationDate: new Date('2026-11-04'),
          contactName: billTo.billToName,
          contactEmail: billTo.billToEmail,
          notes: 'Business plan for up to 10 staff, billed annually.',
          assignedUserId: SEED_USERS.superAdmin.id,
          createdByUserId: SEED_USERS.superAdmin.id,
          lines: {
            create: [{ description: 'Business plan, 12 months', quantity: 12, unitCents: 49900 }],
          },
        },
      });
      await tx.platformEstimate.update({
        where: { id: SEED_PLATFORM_IDS.billingEstimate },
        data: { status: 'SENT' },
      });
      await tx.platformRecurringInvoice.create({
        data: {
          id: SEED_PLATFORM_IDS.billingRecurring,
          businessId: businesses.lvp,
          description: 'Team Pro plan, monthly',
          frequency: 'MONTHLY',
          lineTemplate: [
            { description: 'Team Pro plan', quantity: 1, unitCents: 19900, taxRateBps: 0 },
          ],
          amountCents: 19900,
          startDate: new Date('2026-09-01'),
          nextInvoiceDate: new Date('2026-11-01'),
          createdByUserId: SEED_USERS.superAdmin.id,
        },
      });
      await tx.platformPaymentEvent.create({
        data: {
          eventId: 'evt_seed_platform_payment',
          type: 'payment_intent.succeeded',
          paymentId: SEED_PLATFORM_IDS.billingPayment,
          processedAt: new Date(),
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
  // The export worker's part (platform scope): the sample export ran and is ready to download.
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    const id = SEED_PLATFORM_IDS.exportJob;
    await tx.platformExportJob.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const finishedAt = new Date();
    await tx.platformExportJob.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: 'COMPLETED',
        finishedAt,
        rowCount: 42,
        sizeBytes: 6144,
        s3Key: `platform/exports/${id}/audit-events.csv`,
        expiresAt: new Date(finishedAt.getTime() + 7 * 86_400_000),
      },
    });
  });
  // Stage B2: LVP's owner answers from the firm's side (business scope, as himself), and the
  // scanner clears the screenshot (platform scope).
  await runInScope(
    prisma,
    { kind: 'business', businessId: businesses.lvp, actorUserId: SEED_USERS.lvpOwner.id },
    async (tx) => {
      if (
        await tx.supportTicketMessage.findUnique({
          where: { id: SEED_PLATFORM_IDS.supportFirmReply },
        })
      ) {
        return;
      }
      await tx.supportTicketMessage.create({
        data: {
          id: SEED_PLATFORM_IDS.supportFirmReply,
          businessId: businesses.lvp,
          ticketId: SEED_PLATFORM_IDS.supportTicket,
          authorUserId: SEED_USERS.lvpOwner.id,
          authorSide: 'CUSTOMER',
          body: 'That fixed it, thank you!',
        },
      });
    },
  );
  await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.supportTicketAttachment.updateMany({
      where: { id: SEED_PLATFORM_IDS.supportAttachment, scanStatus: 'PENDING' },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
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
    // Stage B4: a normalized event in the firm's log: six failed sign-ins in a row on LVP's
    // portal for one email, from one address (documentation range).
    if (!(await tx.auditLog.findUnique({ where: { id: SEED_PLATFORM_IDS.securityEvent } }))) {
      await tx.auditLog.create({
        data: {
          id: SEED_PLATFORM_IDS.securityEvent,
          businessId: businesses.lvp,
          action: 'login.failed',
          entityType: 'login',
          metadata: { pool: 'clients', attempts: 6 },
          ip: '203.0.113.24',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0',
          category: 'AUTHENTICATION',
          severity: 'MEDIUM',
          outcome: 'FAILURE',
          actorType: 'ANONYMOUS',
          authMethod: 'password',
          targetLabel: SEED_USERS.lvpClient.email,
          subjectUserId: SEED_USERS.lvpClient.id,
          detectionSource: 'sign_in',
        },
      });
    }
  });
  // Stage B4: the rules engine raises an alert on it (platform scope); the Super Admin takes it,
  // acknowledges it and notes what they found (admin scope).
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    if (!(await tx.securityAlert.findUnique({ where: { id: SEED_PLATFORM_IDS.securityAlert } }))) {
      await tx.securityAlert.create({
        data: {
          id: SEED_PLATFORM_IDS.securityAlert,
          auditLogId: SEED_PLATFORM_IDS.securityEvent,
          businessId: businesses.lvp,
          ruleId: 'login.failed_burst',
          severity: 'HIGH',
          title: 'Repeated failed sign-ins on a client account',
          summary: 'Six failed sign-ins in 4 minutes for one client of LVP from one IP address.',
          riskScore: 72,
          eventKey: `login.failed_burst:${SEED_PLATFORM_IDS.securityEvent}`,
        },
      });
    }
  });
  await runInScope(prisma, { kind: 'admin', adminUserId: SEED_USERS.superAdmin.id }, async (tx) => {
    await tx.securityAlert.updateMany({
      where: { id: SEED_PLATFORM_IDS.securityAlert, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', assignedToUserId: SEED_USERS.superAdmin.id },
    });
    if (
      !(await tx.auditInvestigationNote.findUnique({
        where: { id: SEED_PLATFORM_IDS.securityNote },
      }))
    ) {
      await tx.auditInvestigationNote.create({
        data: {
          id: SEED_PLATFORM_IDS.securityNote,
          auditLogId: SEED_PLATFORM_IDS.securityEvent,
          authorUserId: SEED_USERS.superAdmin.id,
          body: 'The client confirmed they forgot their password and reset it. No other activity from this address.',
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

  // INV-1002, part paid by a check the owner recorded: the database takes an offline payment only
  // from the acting Owner or Admin, on an OPEN invoice, within the balance due.
  await runInScope(
    prisma,
    { kind: 'business', businessId: businesses.lvp, actorUserId: SEED_USERS.lvpOwner.id },
    async (tx) => {
      const lvp = { businessId: businesses.lvp };
      const invoiceId = SEED_BILLING_IDS.offlineInvoice;
      if (await tx.invoice.findUnique({ where: { id: invoiceId } })) return;
      await tx.invoice.create({
        data: {
          ...lvp,
          id: invoiceId,
          clientId: SEED_CLIENT_IDS.lvp,
          engagementId: SEED_WORK_IDS.lvpBookkeeping,
          number: 'INV-1002',
          createdByUserId: SEED_USERS.lvpOwner.id,
        },
      });
      await tx.invoiceLine.create({
        data: {
          ...lvp,
          invoiceId,
          description: 'Bookkeeping (Growth), October 2026',
          unitAmountCents: 30000,
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'OPEN', issuedAt: new Date(), dueOn: new Date('2026-11-30') },
      });
      await tx.offlinePayment.create({
        data: {
          ...lvp,
          id: SEED_BILLING_IDS.offlinePayment,
          invoiceId,
          method: 'CHECK',
          amountCents: 10000,
          reference: '1042',
          receivedOn: new Date('2026-10-05'),
          idempotencyKey: SEED_BILLING_IDS.offlinePaymentKey,
          recordedByUserId: SEED_USERS.lvpOwner.id,
        },
      });
    },
  );

  await runInScope(prisma, { kind: 'business', businessId: businesses.testFirmB }, async (tx) => {
    await tx.membership.upsert({
      where: {
        businessId_userId: { businessId: businesses.testFirmB, userId: SEED_USERS.firmBOwner.id },
      },
      update: { role: 'OWNER', status: 'ACTIVE', meetingUrl: SEED_MEETING_URLS.firmBOwner },
      create: {
        businessId: businesses.testFirmB,
        userId: SEED_USERS.firmBOwner.id,
        role: 'OWNER',
        status: 'ACTIVE',
        meetingUrl: SEED_MEETING_URLS.firmBOwner,
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
    await seedFirmAgreement(
      tx,
      businesses.testFirmB,
      SEED_USERS.firmBOwner.id,
      SEED_AGREEMENT_IDS.testFirmB,
    );
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
    await seedEsignDraft(tx, businesses.testFirmB);
  });

  await seedR36(prisma, businesses);
  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, (tx) =>
    seedR37(tx, businesses.lvp),
  );

  // Stage B6: Firmivra's communications. The Super Admin welcomes LVP's owner by email (admin
  // scope), the dispatcher sends it and records the reply (platform scope), and the team keeps an
  // internal note; an onboarding template with its logo, an audience and a sent broadcast.
  await seedCommunications(businesses.lvp);

  // R0 stage A: Firmivra's own org chart and the plan ladder (platform reference data, not
  // tenant data). No subscription rows: no backfill for existing firms (Rasel's change C).
  await seedPlatformTeam(prisma);
  await seedPlatformPlans(prisma);

  console.warn(
    `Seeded: Super Admin, ${SEED_BUSINESSES.lvp.name} (owner, staff, invited staff, client), ${SEED_BUSINESSES.testFirmB.name} (owner, client), with settings, Terms, Privacy, tax statuses, clients, services, engagements, documents, intake forms, intake agreements, a signed Begin Online lead, notifications, a calendar, messages, invoices, content, a calculator, an approved firm application, a support request, sample audit events, Firm Sign (LVP: on, with a sent request; Firm B: off, one draft), the platform team hierarchy (13 departments, the CEO mapped from Super Admin) and the 6-plan ladder.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
