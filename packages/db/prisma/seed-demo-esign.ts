// Demo seed, stage 3 (R0, PART 2): Firm Sign. Settings, consent v1, a Manager role, two templates,
// and nine requests in every state the Requests list filters on: draft, sent, viewed, completed
// (with its filed final PDF and certificate in Documents), declined, expired and voided. The portal
// client (01) signs through her login, so her portal Signatures page shows one completed and one
// waiting; everyone else signs through an emailed link. Each request is built once as a DRAFT and
// moved the way the app moves it (the database checks every step). Records only: no PDF in S3.
import { createHash } from 'node:crypto';
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, demoEngagementId, type DemoEngagementSlot } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const hex = (label: string) => createHash('sha256').update(label).digest('hex');

/** The demo firm's e-signature consent, v1 (synthetic; the portal shows it before signing). */
const DEMO_ESIGN_CONSENT =
  'You agree to receive and sign documents from Demo Accounting Group electronically. Your electronic signature has the same effect as a handwritten one. You can ask us for a paper copy of any document at no charge, and you can withdraw this consent at any time by contacting us.';

type Outcome = 'DRAFT' | 'SENT' | 'VIEWED' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'VOIDED';

interface DemoRequest {
  key: string;
  title: string;
  template: 'letter' | 'f8879' | 'books';
  clientKey: string;
  slot: DemoEngagementSlot;
  sender: DemoStaffKey;
  outcome: Outcome;
  /** Days from today it was sent (and, for a finished one, when it finished). */
  sent: number;
  finished?: number;
  reason?: string;
}

const REQUESTS: readonly DemoRequest[] = [
  {
    key: 's1',
    title: '2025 Engagement Letter',
    template: 'letter',
    clientKey: '01',
    slot: 'tax2025',
    sender: 'manager',
    outcome: 'COMPLETED',
    sent: -14,
    finished: -13,
  },
  {
    key: 's2',
    title: 'Form 8879: 2025 IRS e-file Authorization',
    template: 'f8879',
    clientKey: '01',
    slot: 'tax2025',
    sender: 'manager',
    outcome: 'SENT',
    sent: -1,
  },
  {
    key: 's3',
    title: 'Bookkeeping Services Agreement',
    template: 'books',
    clientKey: '04',
    slot: 'books',
    sender: 'bookkeeper',
    outcome: 'COMPLETED',
    sent: -40,
    finished: -38,
  },
  {
    key: 's4',
    title: '2025 Engagement Letter',
    template: 'letter',
    clientKey: '03',
    slot: 'tax2025',
    sender: 'taxPreparer',
    outcome: 'VIEWED',
    sent: -3,
  },
  {
    key: 's5',
    title: '2025 Engagement Letter',
    template: 'letter',
    clientKey: '09',
    slot: 'tax2025',
    sender: 'taxPreparer',
    outcome: 'SENT',
    sent: 0,
  },
  {
    key: 's6',
    title: 'Payroll Services Agreement',
    template: 'books',
    clientKey: '22',
    slot: 'payroll',
    sender: 'bookkeeper',
    outcome: 'DECLINED',
    sent: -9,
    finished: -7,
    reason: 'We want to review the fee schedule with our partner first.',
  },
  {
    key: 's7',
    title: '2025 Engagement Letter',
    template: 'letter',
    clientKey: '13',
    slot: 'tax2025',
    sender: 'manager',
    outcome: 'EXPIRED',
    sent: -35,
    finished: -5,
  },
  {
    key: 's8',
    title: '2025 Engagement Letter',
    template: 'letter',
    clientKey: '23',
    slot: 'tax2025',
    sender: 'manager',
    outcome: 'VOIDED',
    sent: -25,
    finished: -20,
    reason: 'Engagement cancelled by the client.',
  },
  {
    key: 's9',
    title: 'Bookkeeping Services Agreement',
    template: 'books',
    clientKey: '19',
    slot: 'books',
    sender: 'bookkeeper',
    outcome: 'DRAFT',
    sent: 0,
  },
];

const TEMPLATES = {
  letter: { name: 'Engagement Letter', pages: 2 },
  f8879: { name: 'Form 8879 e-file Authorization', pages: 1 },
  books: { name: 'Bookkeeping Services Agreement', pages: 3 },
} as const;

const SETTINGS = {
  routing: 'SEQUENTIAL' as const,
  expiryDays: 30,
  reminderFirstAfterDays: 3,
  reminderEveryDays: 3,
  reminderMax: 3,
  expiryWarningDays: 2,
};
const LETTER = { width: 612, height: 792 };
const at = (day: number, hour = 15) => {
  const d = demoDay(day);
  d.setUTCHours(hour);
  return d;
};

async function seedTemplates(tx: TxClient, businessId: string) {
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const id = demoId(`esign-template:${key}`);
    if (await tx.esignTemplate.findUnique({ where: { id } })) continue;
    const packet = hex(`demo template ${key}`);
    await tx.esignTemplate.create({
      data: {
        id,
        businessId,
        name: t.name,
        visibility: 'FIRM',
        ownerUserId: SEED_DEMO_USERS.manager.id,
      },
    });
    await tx.esignTemplateVersion.create({
      data: {
        businessId,
        templateId: id,
        version: 1,
        s3Key: `tenant/${businessId}/esign/${id}/template-${packet}.pdf`,
        sha256: packet,
        sizeBytes: 38_000 * t.pages,
        pageSizes: Array.from({ length: t.pages }, () => LETTER),
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
        ...SETTINGS,
        savedByUserId: SEED_DEMO_USERS.manager.id,
      },
    });
  }
}

export async function seedDemoEsign(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key];

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.esignSettings.upsert({ where: { businessId }, update: {}, create: { businessId } });
    const consent = await tx.esignConsentVersion.upsert({
      where: { businessId_version: { businessId, version: 1 } },
      update: {},
      create: {
        businessId,
        version: 1,
        bodyMarkdown: DEMO_ESIGN_CONSENT,
        sha256: hex(DEMO_ESIGN_CONSENT),
        publishedByUserId: user('owner').id,
      },
    });
    for (const key of ['manager', 'bookkeeper'] as const) {
      await tx.esignMemberRole.upsert({
        where: { businessId_userId: { businessId, userId: user(key).id } },
        update: {},
        create: { businessId, userId: user(key).id, role: 'MANAGER' },
      });
    }
    await seedTemplates(tx, businessId);
    const portalLogin = await tx.clientAccount.findUniqueOrThrow({
      where: { userId: demoId('user:client:01') },
    });

    for (const r of REQUESTS) {
      const id = demoId(`esign-request:${r.key}`);
      if (await tx.esignRequest.findUnique({ where: { id } })) continue;
      const t = TEMPLATES[r.template];
      const client = SEED_DEMO_CLIENTS.find((c) => c.key === r.clientKey)!;
      const sender = user(r.sender);
      const documentId = demoId(`esign-document:${r.key}`);
      const signerId = demoId(`esign-signer:${r.key}`);
      const packet = hex(`demo packet ${r.key}`);
      const req = { businessId, requestId: id };
      const viaLogin = client.portal === true;

      await tx.esignRequest.create({
        data: {
          id,
          businessId,
          title: r.title,
          source: 'TEMPLATE',
          clientId: org.clients[r.clientKey]!,
          engagementId: demoEngagementId(r.clientKey, r.slot),
          senderUserId: sender.id,
          emailSubject: `Please sign: ${r.title}`,
          emailMessage: `Hi ${client.name.split(' ')[0]}, please review and sign at your convenience. Thank you!`,
          ...SETTINGS,
          pagePlan: Array.from({ length: t.pages }, (_, page) => ({
            documentId,
            page,
            rotation: 0,
          })),
          templateId: demoId(`esign-template:${r.template}`),
          templateVersion: 1,
        },
      });
      await tx.esignDocument.create({
        data: {
          ...req,
          id: documentId,
          position: 0,
          fileName: `${t.name}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 38_000 * t.pages,
          pageCount: t.pages,
          pageSizes: Array.from({ length: t.pages }, () => LETTER),
          s3Key: `tenant/${businessId}/esign/${id}/source/${documentId}`,
          sha256: packet,
          scanStatus: 'CLEAN',
          scannedAt: at(r.sent - 1),
        },
      });
      await tx.esignRecipient.create({
        data: {
          ...req,
          id: signerId,
          position: 0,
          kind: 'SIGNER',
          role: 'CLIENT',
          routingOrder: 1,
          name: client.name,
          email: client.email,
          linkType: viaLogin ? 'CLIENT_LOGIN' : 'EXTERNAL',
          clientAccountId: viaLogin ? portalLogin.id : null,
          delivery: 'EMAIL',
          authMethod: 'EMAIL_CODE',
          colorIndex: 0,
        },
      });
      const box = { w: 0.3, h: 0.05, x: 0.1, required: true };
      await tx.esignField.createMany({
        data: [
          {
            ...req,
            ...box,
            recipientId: signerId,
            position: 0,
            type: 'SIGNATURE',
            pageIndex: t.pages - 1,
            y: 0.78,
          },
          {
            ...req,
            ...box,
            recipientId: signerId,
            position: 1,
            type: 'DATE_SIGNED',
            pageIndex: t.pages - 1,
            y: 0.84,
          },
        ],
      });
      const event = (
        type:
          | 'CREATED'
          | 'SENT'
          | 'VIEWED'
          | 'SIGNED'
          | 'COMPLETED'
          | 'DECLINED'
          | 'EXPIRED'
          | 'VOIDED',
        day: number,
        actor: 'STAFF' | 'SIGNER' | 'SYSTEM',
        reason?: string,
      ) => ({
        ...req,
        type,
        createdAt: at(day),
        actorKind: actor,
        actorUserId: actor === 'STAFF' ? sender.id : null,
        actorName: actor === 'STAFF' ? sender.name : actor === 'SIGNER' ? client.name : 'Firm Sign',
        ...(actor === 'SIGNER' ? { recipientId: signerId, recipientName: client.name } : {}),
        ...(reason ? { reason } : {}),
      });
      const events = [event('CREATED', r.sent - 1, 'STAFF')];
      if (r.outcome === 'DRAFT') {
        await tx.esignEvent.createMany({ data: events });
        continue;
      }

      const sentAt = at(r.sent);
      await tx.esignRequest.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt,
          expiresAt: new Date(sentAt.getTime() + SETTINGS.expiryDays * 86_400_000),
          originalSha256: packet,
          lastActivityAt: sentAt,
        },
      });
      await tx.esignRecipient.update({ where: { id: signerId }, data: { status: 'SENT', sentAt } });
      events.push(event('SENT', r.sent, 'STAFF'));

      const viewed = r.outcome !== 'SENT' && r.outcome !== 'EXPIRED' && r.outcome !== 'VOIDED';
      if (viewed) {
        const viewedAt = at(r.finished ?? r.sent, 14);
        await tx.esignRequest.update({
          where: { id },
          data: { status: 'VIEWED', lastActivityAt: viewedAt },
        });
        await tx.esignRecipient.update({
          where: { id: signerId },
          data: { status: 'VIEWED', viewedAt },
        });
        events.push(event('VIEWED', r.finished ?? r.sent, 'SIGNER'));
      }

      if (r.outcome === 'COMPLETED') {
        const signedAt = at(r.finished!, 16);
        await tx.esignRecipient.update({
          where: { id: signerId },
          data: {
            status: 'SIGNED',
            signedAt,
            consentVersionId: consent.id,
            consentedAt: signedAt,
            printedName: client.name,
            signatureMethod: 'TYPED',
            signatureText: client.name,
            adoptedAt: signedAt,
          },
        });
        await tx.esignRequest.update({
          where: { id },
          data: { status: 'PARTIALLY_SIGNED', lastActivityAt: signedAt },
        });
        const finalSha = hex(`demo final ${r.key}`);
        const certSha = hex(`demo certificate ${r.key}`);
        await tx.esignRequest.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            completedAt: signedAt,
            finalSha256: finalSha,
            certificateSha256: certSha,
          },
        });
        // The server-made final PDF and certificate, filed on the client's engagement.
        const filed = async (kind: 'final' | 'certificate', sha256: string, fileName: string) => {
          const docId = demoId(`esign-${kind}:${r.key}`);
          await tx.document.create({
            data: {
              id: docId,
              businessId,
              clientId: org.clients[r.clientKey]!,
              engagementId: demoEngagementId(r.clientKey, r.slot),
              categoryId: org.categoryIds('Signed Documents'),
              esignRequestId: id,
              direction: 'FIRM_TO_CLIENT',
              fileName,
              contentType: 'application/pdf',
              sizeBytes: kind === 'final' ? 41_000 * t.pages : 22_000,
              sha256,
              s3Key: `tenant/${businessId}/esign/${id}/${kind}/${docId}.pdf`,
              scanStatus: 'CLEAN',
              scannedAt: signedAt,
              legalHold: true,
              uploadedByUserId: sender.id,
            },
          });
          return docId;
        };
        const finalId = await filed('final', finalSha, `${r.title} (signed).pdf`);
        const certId = await filed('certificate', certSha, `${r.title} (certificate).pdf`);
        await tx.esignRequest.update({
          where: { id },
          data: { finalDocumentId: finalId, certificateDocumentId: certId },
        });
        events.push(
          event('SIGNED', r.finished!, 'SIGNER'),
          event('COMPLETED', r.finished!, 'SYSTEM'),
        );
      }
      if (r.outcome === 'DECLINED') {
        const declinedAt = at(r.finished!, 16);
        await tx.esignRecipient.update({
          where: { id: signerId },
          data: { status: 'DECLINED', declinedAt, declineReason: r.reason! },
        });
        await tx.esignRequest.update({
          where: { id },
          data: { status: 'DECLINED', lastActivityAt: declinedAt },
        });
        events.push(event('DECLINED', r.finished!, 'SIGNER', r.reason));
      }
      if (r.outcome === 'EXPIRED') {
        await tx.esignRequest.update({
          where: { id },
          data: { status: 'EXPIRED', expiredAt: at(r.finished!), lastActivityAt: at(r.finished!) },
        });
        events.push(event('EXPIRED', r.finished!, 'SYSTEM'));
      }
      if (r.outcome === 'VOIDED') {
        await tx.esignRequest.update({
          where: { id },
          data: {
            status: 'VOIDED',
            voidedAt: at(r.finished!),
            voidReason: r.reason!,
            voidedByUserId: sender.id,
            lastActivityAt: at(r.finished!),
          },
        });
        events.push(event('VOIDED', r.finished!, 'STAFF', r.reason));
      }
      await tx.esignEvent.createMany({ data: events });
    }
  });
}
