// Demo seed, stage 5 (R0, Oct 19): Communications for the demo firm. Audience segments (a static
// list and two dynamic ones) and each client's email and text consent; campaigns that went out
// (an email to a segment, with opens, clicks and a bounce; a text to three clients), one scheduled
// and one draft; a scheduled portal reminder with its recipients and a file; the firm's message
// settings, staff signatures, and tags and mutes on inbox threads; and notification preferences
// and deliveries for the bell items the demo already has. Synthetic data; fixed ids, created once,
// so a re-run changes nothing.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const id = (key: string) => demoId(`comms:${key}`);
const HOUR_MS = 3_600_000;

/** A masked address, as the screens show it (never the address itself). */
const mask = (email: string | null) =>
  email ? `${email[0]}***@${email.split('@')[1]}` : 'n***@demo.test';

export async function seedDemoCommunications(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    if (await tx.communicationSegment.findUnique({ where: { id: id('segment:planning') } })) return;
    const clients = await tx.client.findMany({
      where: { businessId, id: { in: Object.values(org.clients) } },
      select: { id: true, email: true, accountType: true },
      orderBy: { id: 'asc' },
    });
    const email = (clientId: string) => clients.find((c) => c.id === clientId)?.email ?? null;
    const business = SEED_DEMO_CLIENTS.filter((c) => c.accountType === 'BUSINESS').map(
      (c) => org.clients[c.key]!,
    );
    const optedOut = business[business.length - 1]!;

    // Segments and consent.
    await tx.communicationSegment.create({
      data: {
        id: id('segment:planning'),
        businessId,
        name: 'Business clients: year-end planning',
        description: 'Owners we invite to a year-end planning call.',
        type: 'STATIC',
        memberCount: business.length,
        ownerUserId: user('manager'),
      },
    });
    for (const clientId of business) {
      await tx.communicationSegmentMember.create({
        data: { businessId, segmentId: id('segment:planning'), clientId },
      });
    }
    for (const [key, name, criteria, summary] of [
      [
        'individuals',
        'Individual clients',
        { all: [{ field: 'type', is: 'INDIVIDUAL' }] },
        'Type is Individual',
      ],
      [
        'open-returns',
        'Clients with a return in progress',
        {
          all: [
            { field: 'service', is: 'ANNUAL_TAX' },
            { field: 'engagement_status', is: 'ACTIVE' },
          ],
        },
        'Annual Tax engagement is active',
      ],
    ] as const) {
      await tx.communicationSegment.create({
        data: {
          id: id(`segment:${key}`),
          businessId,
          name,
          type: 'DYNAMIC',
          criteria,
          criteriaSummary: summary,
          lastRefreshedAt: demoDay(-1),
          ownerUserId: user('clientSupport'),
        },
      });
    }
    for (const [i, c] of clients.entries()) {
      await tx.communicationConsent.create({
        data: {
          businessId,
          clientId: c.id,
          channel: 'EMAIL',
          status: c.id === optedOut ? 'OPTED_OUT' : 'OPTED_IN',
          source: c.id === optedOut ? 'unsubscribe_link' : i % 2 === 0 ? 'portal' : 'intake',
        },
      });
      if (i % 4 === 0) {
        await tx.communicationConsent.create({
          data: {
            businessId,
            clientId: c.id,
            channel: 'SMS',
            status: 'OPTED_IN',
            source: 'portal',
          },
        });
      }
    }

    // An email to the planning list that went out three days ago: opens, clicks, one bounce;
    // the opted-out client was left out by the system.
    const planning = id('campaign:planning');
    const sentAt = demoDay(-3);
    await tx.communication.create({
      data: {
        id: planning,
        businessId,
        channel: 'EMAIL',
        name: 'Year-end planning invitation',
        subject: 'Let’s plan your year-end taxes',
        previewText: 'Book a 30-minute planning call before December 15.',
        body: 'Hello [Client First Name],\n\nYear-end is the last chance to lower this year’s taxes. Book a 30-minute planning call with us before December 15: [Booking Link].\n\nDemo Accounting Group',
        fromName: 'Demo Accounting Group',
        createdByUserId: user('manager'),
      },
    });
    await tx.communicationAudienceEntry.create({
      data: {
        businessId,
        communicationId: planning,
        kind: 'SEGMENT',
        segmentId: id('segment:planning'),
        segmentName: 'Business clients: year-end planning',
        criteriaSnapshot: {},
      },
    });
    const reached = business.filter((c) => c !== optedOut);
    await tx.communication.update({
      where: { id: planning },
      data: {
        status: 'SENDING',
        startedAt: sentAt,
        selectedCount: business.length,
        autoExcludedCount: 1,
        manualExcludedCount: 0,
        finalCount: reached.length,
        exclusionCounts: { opted_out: 1 },
      },
    });
    for (const [k, clientId] of reached.entries()) {
      const shape = (['CLICKED', 'OPENED', 'OPENED', 'DELIVERED', 'BOUNCED'] as const)[k % 5]!;
      const opened = shape === 'OPENED' || shape === 'CLICKED';
      const recipientId = id(`campaign:planning:recipient:${k}`);
      await tx.communicationRecipient.create({
        data: {
          id: recipientId,
          businessId,
          communicationId: planning,
          clientId,
          status: shape,
          addressMask: mask(email(clientId)),
          sentAt,
          ...(shape === 'BOUNCED'
            ? { failureCode: 'mailbox_unavailable' }
            : { deliveredAt: new Date(sentAt.getTime() + 60_000) }),
          ...(opened
            ? {
                firstOpenedAt: new Date(sentAt.getTime() + (k + 1) * HOUR_MS),
                openCount: (k % 3) + 1,
              }
            : {}),
          ...(shape === 'CLICKED'
            ? { firstClickedAt: new Date(sentAt.getTime() + 2 * HOUR_MS), clickCount: 1 }
            : {}),
        },
      });
      const events: ('SENT' | 'DELIVERED' | 'OPENED' | 'CLICKED' | 'BOUNCED')[] =
        shape === 'BOUNCED'
          ? ['SENT', 'BOUNCED']
          : ['SENT', 'DELIVERED', ...(opened ? (['OPENED'] as const) : [])];
      if (shape === 'CLICKED') events.push('CLICKED');
      for (const [e, type] of events.entries()) {
        await tx.communicationEvent.create({
          data: {
            businessId,
            communicationId: planning,
            recipientId,
            type,
            occurredAt: new Date(sentAt.getTime() + e * HOUR_MS),
          },
        });
      }
    }
    await tx.communication.update({ where: { id: planning }, data: { status: 'SENT', sentAt } });

    // A text to three clients about the extension deadline, all delivered.
    const extension = id('campaign:extension');
    const textAt = demoDay(-8);
    const texted = SEED_DEMO_CLIENTS.filter((c) => c.accountType === 'INDIVIDUAL')
      .slice(1, 4)
      .map((c) => org.clients[c.key]!);
    await tx.communication.create({
      data: {
        id: extension,
        businessId,
        channel: 'SMS',
        name: 'Extension deadline reminder',
        body: 'Demo Accounting Group: your extended return is due Oct 15. Upload any last documents in your portal today.',
        createdByUserId: user('taxPreparer'),
      },
    });
    for (const clientId of texted) {
      await tx.communicationAudienceEntry.create({
        data: { businessId, communicationId: extension, kind: 'CLIENT', clientId },
      });
    }
    await tx.communication.update({
      where: { id: extension },
      data: {
        status: 'SENDING',
        startedAt: textAt,
        selectedCount: texted.length,
        autoExcludedCount: 0,
        manualExcludedCount: 0,
        finalCount: texted.length,
      },
    });
    for (const [k, clientId] of texted.entries()) {
      const recipientId = id(`campaign:extension:recipient:${k}`);
      await tx.communicationRecipient.create({
        data: {
          id: recipientId,
          businessId,
          communicationId: extension,
          clientId,
          status: 'DELIVERED',
          addressMask: `(***) ***-01${k}${k}`,
          sentAt: textAt,
          deliveredAt: new Date(textAt.getTime() + 30_000),
        },
      });
      for (const [e, type] of (['SENT', 'DELIVERED'] as const).entries()) {
        await tx.communicationEvent.create({
          data: {
            businessId,
            communicationId: extension,
            recipientId,
            type,
            occurredAt: new Date(textAt.getTime() + e * 30_000),
          },
        });
      }
    }
    await tx.communication.update({
      where: { id: extension },
      data: { status: 'SENT', sentAt: textAt },
    });

    // The November newsletter, scheduled; a holiday-hours notice, still a draft.
    await tx.communication.create({
      data: {
        id: id('campaign:newsletter'),
        businessId,
        channel: 'EMAIL',
        name: 'November newsletter',
        subject: 'Five year-end moves for small businesses',
        body: 'Hello [Client First Name],\n\nThis month: retirement contributions, equipment purchases, and what the new standard deduction means for you.',
        fromName: 'Demo Accounting Group',
        createdByUserId: user('clientSupport'),
      },
    });
    await tx.communicationAudienceEntry.create({
      data: {
        businessId,
        communicationId: id('campaign:newsletter'),
        kind: 'SEGMENT',
        segmentId: id('segment:individuals'),
        segmentName: 'Individual clients',
        criteriaSnapshot: { all: [{ field: 'type', is: 'INDIVIDUAL' }] },
      },
    });
    await tx.communication.update({
      where: { id: id('campaign:newsletter') },
      data: { status: 'SCHEDULED', scheduledFor: demoDay(5), timezone: 'America/New_York' },
    });
    await tx.communication.create({
      data: {
        id: id('campaign:holiday-hours'),
        businessId,
        channel: 'EMAIL',
        name: 'Holiday office hours',
        subject: 'Our holiday hours',
        body: 'We are closed November 26 and 27, and December 24 to January 1.',
        createdByUserId: user('admin'),
      },
    });

    // A direct portal reminder, scheduled, with its recipient and a checklist file.
    const reminder = id('outbound:reminder');
    const harper = org.clients['01']!;
    await tx.outboundMessage.create({
      data: {
        id: reminder,
        businessId,
        kind: 'DIRECT',
        channel: 'PORTAL',
        subject: 'Your planning meeting',
        body: 'Hi Harper, a reminder about your 2026 planning meeting next week. Please bring last year’s brokerage statements.',
        status: 'SCHEDULED',
        scheduledFor: demoDay(4),
        createdByUserId: user('manager'),
      },
    });
    await tx.outboundMessageRecipient.create({
      data: {
        id: id('outbound:reminder:recipient'),
        businessId,
        outboundMessageId: reminder,
        clientId: harper,
        channel: 'PORTAL',
      },
    });
    await tx.outboundMessageFile.create({
      data: {
        businessId,
        outboundMessageId: reminder,
        fileName: 'Planning meeting checklist.pdf',
        contentType: 'application/pdf',
        sizeBytes: 64_000,
        sha256: 'd'.repeat(64),
        s3Key: `tenant/${businessId}/messages/demo-planning-checklist.pdf`,
        uploadedByUserId: user('manager'),
      },
    });
    await tx.outboundMessage.create({
      data: {
        id: id('outbound:draft'),
        businessId,
        kind: 'DIRECT',
        channel: 'EMAIL',
        subject: 'Question about your 1099-K',
        body: 'Hi, we received a 1099-K for your business account. Can you confirm which sales it covers?',
        createdByUserId: user('bookkeeper'),
      },
    });

    // Message settings, staff signatures, thread tags and mutes.
    await tx.messageSettings.create({
      data: {
        businessId,
        senderName: 'Demo Accounting Group',
        signature: 'Best regards,\nDemo Accounting Group',
      },
    });
    for (const who of ['owner', 'manager', 'taxPreparer', 'bookkeeper', 'clientSupport'] as const) {
      await tx.messageSignature.create({
        data: {
          businessId,
          userId: user(who),
          body: `Best regards,\n${SEED_DEMO_USERS[who].name}\nDemo Accounting Group`,
        },
      });
    }
    for (const [thread, tag] of [
      ['t01', 'New client'],
      ['t02', 'Tax 2025'],
      ['t02', 'Waiting on client'],
      ['t03', 'Planning'],
    ] as const) {
      await tx.messageThreadTag.create({
        data: { businessId, threadId: demoId(`thread:${thread}`), tag },
      });
    }
    for (const [thread, who] of [
      ['t01', 'owner'],
      ['t03', 'bookkeeper'],
    ] as const) {
      await tx.messageThreadMute.create({
        data: { businessId, threadId: demoId(`thread:${thread}`), userId: user(who) },
      });
    }

    await seedNotificationParts(tx, businessId);
  });
}

/** Harper's and two staff members' notification preferences; deliveries for the bell items. */
async function seedNotificationParts(tx: TxClient, businessId: string) {
  const harperUser = demoId('user:client:01');
  for (const [userId, category, emailOn, sms] of [
    [harperUser, 'DOCUMENTS', true, true],
    [harperUser, 'BILLING', true, false],
    [harperUser, 'APPOINTMENTS', true, true],
    [user('manager'), 'INTAKE', true, false],
    [user('bookkeeper'), 'BILLING', false, false],
  ] as const) {
    await tx.notificationPreference.create({
      data: { businessId, userId, category, email: emailOn, sms },
    });
  }
  const notifications = await tx.notification.findMany({
    where: { businessId },
    select: { id: true, recipientUserId: true },
    orderBy: { id: 'asc' },
  });
  for (const [k, n] of notifications.entries()) {
    const deliveryId = demoId(`comms:delivery:${n.id}:email`);
    await tx.notificationDelivery.create({
      data: { id: deliveryId, businessId, notificationId: n.id, channel: 'EMAIL' },
    });
    if (k === 3) {
      await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'FAILED', attempts: 3, lastError: 'mailbox_full' },
      });
    } else {
      await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SENT', attempts: 1, sentAt: demoDay(-1), providerMessageId: `demo-${k}` },
      });
    }
    if (n.recipientUserId === harperUser) {
      const smsId = demoId(`comms:delivery:${n.id}:sms`);
      await tx.notificationDelivery.create({
        data: { id: smsId, businessId, notificationId: n.id, channel: 'SMS' },
      });
      await tx.notificationDelivery.update({
        where: { id: smsId },
        data:
          k % 2 === 0
            ? {
                status: 'SENT',
                attempts: 1,
                sentAt: demoDay(-1),
                providerMessageId: `demo-sms-${k}`,
              }
            : { status: 'SKIPPED' },
      });
    }
  }
}
