// QA seed, part 2 (R1; Rasel's "Seed + test login" in R1's window, Nov 7, and R56's fixture list):
// rows for LVP only, plus platform rows for the Super Admin. Synthetic: names "QA ... (fake)",
// addresses @qa.test, links example.test. Fixed ids, created once (a re-run adds nothing), never
// an update to a row it did not make.
// - CD-Y02: eight business clients with profiles across entity types and states.
// - CD-Y05: a state calendar with a published v1 and a draft v2 (a changed date, a removed entry,
//   a new entry and one whose date needs verification).
// - CD-Y17: an open service for client 1, a document row filed under it, unscanned until its file
//   reaches the dev bucket in the AWS step (qaFixturePdf() is the exact bytes) and the scan marks
//   it CLEAN, and a second deadline.
// - RP-Y06/Y07: three schedules of the built-in revenue summary (active, paused, failing), in-app
//   delivery only, with their runs.
// - RP-Y10/IP-F19: five invoices for client 4 with check, ACH, cash (a time-zone boundary) and a
//   voided card payment, and a $0 draft.
// - Super Admin: firm applications waiting for a decision, and sales records in the pipeline.
// Nothing sendable: no email delivery on any schedule, no reminders, follow-ups and dates chosen so
// no job or rule picks them up before Octavia does (clients are created in the past, so a
// client.created rule never matches them; open invoices are due in 2027, so invoice.overdue never
// does). LVP's active Owner records the payments and owns the schedules (the database requires an
// active Owner or Admin for a payment; R56's list names the Owner).
import { createHash } from 'node:crypto';
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

/** Part 2's fixed ids: 00000000-0000-4a28-8005-<n> (LVP and platform rows). */
export const qaExtraId = (n: number) => `00000000-0000-4a28-8005-${String(n).padStart(12, '0')}`;
const id = qaExtraId;
const PAST = new Date('2026-09-01T12:00:00Z');
const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** A one-page PDF reading "Synthetic test document": the document row's sha256 and size are of
 *  exactly these bytes, which the AWS step uploads to the row's S3 key. */
export function qaFixturePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const text = 'BT /F1 18 Tf 72 720 Td (Synthetic test document) Tj ET';
  objects[3] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export interface QaExtraResult {
  lvp: 'seeded' | 'already' | 'missing' | 'no-owner';
  platform: 'seeded' | 'already' | 'no-super-admin';
  /** The document row's S3 key, for the AWS step that uploads qaFixturePdf(). */
  documentKey: string | null;
}

export async function seedQaExtra(owner: PrismaClient): Promise<QaExtraResult> {
  const result: QaExtraResult = { lvp: 'missing', platform: 'no-super-admin', documentKey: null };
  const lvp = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: 'lvp' }, select: { id: true } }),
  );
  if (lvp) {
    const businessId = lvp.id;
    const ownerMember = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.findFirst({
        where: { businessId, role: 'OWNER', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      }),
    );
    if (!ownerMember) {
      result.lvp = 'no-owner';
    } else {
      const ownerId = ownerMember.userId;
      result.documentKey = `tenant/${businessId}/documents/${id(300)}`;
      result.lvp = await runInScope(
        owner,
        { kind: 'business', businessId, actorUserId: ownerId },
        async (tx) => {
          if (await tx.client.findUnique({ where: { id: id(1) } })) return 'already' as const;
          await seedLvp(tx, businessId, ownerId, result.documentKey!);
          return 'seeded' as const;
        },
      );
    }
  }
  const admin = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.platformAdmin.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } }),
  );
  if (admin) {
    result.platform = await runInScope(
      owner,
      { kind: 'admin', adminUserId: admin.userId },
      async (tx) => {
        if (await tx.firmApplication.findUnique({ where: { id: id(600) } })) {
          return 'already' as const;
        }
        await seedPlatform(tx, admin.userId);
        return 'seeded' as const;
      },
    );
  }
  return result;
}

const CLIENTS = [
  ['QA Single Member LLC (fake)', 'Single-member LLC', 'NY', 'ACTIVE'],
  ['QA Multi Member LLC (fake)', 'Multi-member LLC', 'NJ', 'ACTIVE'],
  ['QA S Election LLC (fake)', 'LLC electing S corporation', 'NY', 'ACTIVE'],
  ['QA C Corp (fake)', 'C corporation', 'DE', 'ACTIVE'],
  ['QA Partnership (fake)', 'Partnership', 'NY', 'ACTIVE'],
  ['QA Bare LLC (fake)', 'LLC', 'NY', 'ACTIVE'],
  ['QA No Entity (fake)', null, null, 'ACTIVE'],
  ['QA Inactive S Corp (fake)', 'S corporation', 'NY', 'INACTIVE'],
] as const;

async function seedLvp(tx: TxClient, businessId: string, ownerId: string, documentKey: string) {
  // CD-Y02: business clients, created in the past (no client.created rule matches them).
  for (const [i, [name, entityType, state, status]] of CLIENTS.entries()) {
    await tx.client.create({
      data: {
        id: id(i + 1),
        businessId,
        displayName: name,
        accountType: 'BUSINESS',
        status,
        createdAt: PAST,
      },
    });
    await tx.clientProfile.create({
      data: { clientId: id(i + 1), businessId, businessName: name, entityType, state },
    });
  }
  await seedStateCalendar(tx, businessId, ownerId);
  await seedClientWork(tx, businessId, ownerId, documentKey);
  await seedSchedules(tx, businessId, ownerId);
  await seedInvoices(tx, businessId, ownerId);
}

/** CD-Y05: v1 published and verified, v2 a draft that changes, removes and adds entries. */
async function seedStateCalendar(tx: TxClient, businessId: string, ownerId: string) {
  const calendar = (n: number, version: number, sourceUrl: string) =>
    tx.complianceCalendar.create({
      data: {
        id: id(n),
        businessId,
        family: 'STATE_INCOME_FRANCHISE',
        authority: 'QA Fake Revenue Dept',
        jurisdiction: 'STATE',
        state: 'NY',
        effectiveYear: 2027,
        version,
        name: 'QA Fake State Calendar 2027',
        sourceUrl,
        retrievedAt: day('2026-10-01'),
        createdByUserId: ownerId,
      },
    });
  const entry = (
    n: number,
    calendarId: number,
    name: string,
    type: 'TAX_FILING',
    dueOn: string | null,
  ) =>
    tx.complianceCalendarEntry.create({
      data: {
        id: id(n),
        businessId,
        calendarId: id(calendarId),
        name,
        type,
        ruleKind: dueOn ? 'FIXED_DATE' : 'NEEDS_VERIFICATION',
        dueOn: dueOn ? day(dueOn) : null,
      },
    });
  await calendar(100, 1, 'https://example.test/qa-calendar-2027-v1');
  await entry(101, 100, 'QA Form 100 Annual Return', 'TAX_FILING', '2027-04-15');
  await entry(102, 100, 'QA Form 200 Q1 Estimate', 'ESTIMATED_TAX' as 'TAX_FILING', '2027-04-15');
  await entry(
    103,
    100,
    'QA Form 300 Franchise Report',
    'STATE_FILING' as 'TAX_FILING',
    '2027-03-15',
  );
  await tx.complianceCalendar.update({
    where: { id: id(100) },
    data: { status: 'VERIFIED', verifiedAt: new Date('2026-10-01T12:00:00Z') },
  });
  await tx.complianceCalendar.update({
    where: { id: id(100) },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date('2026-10-01T12:30:00Z'),
      publishedByUserId: ownerId,
    },
  });
  await calendar(110, 2, 'https://example.test/qa-calendar-2027-v2');
  await entry(111, 110, 'QA Form 100 Annual Return', 'TAX_FILING', '2027-04-16');
  await entry(112, 110, 'QA Form 200 Q1 Estimate', 'ESTIMATED_TAX' as 'TAX_FILING', '2027-04-15');
  await entry(113, 110, 'QA Form 400 Annual Report', 'ANNUAL_REPORT' as 'TAX_FILING', '2027-05-01');
  await entry(114, 110, 'QA Form 500 Unknown Date', 'TAX_FILING', null);
}

/** CD-Y17: client 1's open service, a document filed under it (PENDING until its scan), and a second deadline. */
async function seedClientWork(tx: TxClient, businessId: string, ownerId: string, key: string) {
  const service =
    (await tx.service.findFirst({
      where: { businessId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })) ??
    (await tx.service.create({
      data: { id: id(200), businessId, kind: 'ANNUAL_TAX', name: 'QA Fixture Service (fake)' },
      select: { id: true },
    }));
  await tx.engagement.create({
    data: {
      id: id(201),
      businessId,
      clientId: id(1),
      serviceId: service.id,
      title: 'QA Annual Return (fake)',
      status: 'ACTIVE',
    },
  });
  const pdf = qaFixturePdf();
  await tx.document.create({
    data: {
      id: id(300),
      businessId,
      clientId: id(1),
      engagementId: id(201),
      direction: 'FIRM_TO_CLIENT',
      fileName: 'qa-engagement-letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      s3Key: key,
    },
  });
  const due = new Date();
  due.setUTCHours(0, 0, 0, 0);
  due.setUTCDate(due.getUTCDate() + 30);
  await tx.complianceDeadline.create({
    data: {
      id: id(310),
      businessId,
      clientId: id(1),
      name: 'QA Second Deadline',
      type: 'TAX_FILING',
      source: 'FIRM',
      dueOn: due,
      priority: 'MEDIUM',
      status: 'UPCOMING',
      createdByUserId: ownerId,
    },
  });
}

/** RP-Y06/Y07: the built-in revenue summary on three schedules, in-app only, with their runs. */
async function seedSchedules(tx: TxClient, businessId: string, ownerId: string) {
  const NEVER = new Date('2099-01-05T13:00:00Z');
  const schedules = [
    [400, 'QA Active Weekly', 'WEEKLY', { weekday: 1, active: true, lastStatus: 'SUCCEEDED' }],
    [401, 'QA Paused Monthly', 'MONTHLY', { dayOfMonth: 1, active: false }],
    [
      402,
      'QA Failing Weekly',
      'WEEKLY',
      { weekday: 3, active: true, lastStatus: 'FAILED', consecutiveFailures: 2 },
    ],
  ] as const;
  for (const [n, name, frequency, extra] of schedules) {
    await tx.reportSchedule.create({
      data: {
        id: id(n),
        businessId,
        systemKey: 'revenue_summary',
        name,
        frequency,
        runTime: new Date('1970-01-01T08:00:00Z'),
        timezone: 'America/New_York',
        datePreset: 'last_week',
        formats: ['CSV'],
        deliverEmail: false,
        deliverInApp: true,
        ownerUserId: ownerId,
        nextRunAt: extra.active ? NEVER : null,
        lastRunAt: new Date('2026-11-02T13:00:00Z'),
        ...extra,
      },
    });
    await tx.reportScheduleRecipient.create({
      data: { id: id(n + 10), businessId, scheduleId: id(n), userId: ownerId },
    });
  }
  const runs = [
    [420, 400, 'SUCCEEDED'],
    [421, 400, 'SUCCEEDED'],
    [422, 401, 'SUCCEEDED'],
    [423, 401, 'SUCCEEDED'],
    [424, 402, 'SUCCEEDED'],
    [425, 402, 'FAILED'],
  ] as const;
  for (const [n, schedule, status] of runs) {
    await tx.reportRun.create({
      data: {
        id: id(n),
        businessId,
        systemKey: 'revenue_summary',
        scheduleId: id(schedule),
        kind: 'SCHEDULED',
        status,
        format: 'CSV',
        sensitive: true,
        rangeFrom: day('2026-10-26'),
        rangeTo: day('2026-11-01'),
        definitionSnapshot: { systemKey: 'revenue_summary' },
        rowCount: status === 'FAILED' ? null : 3,
        errorCode: status === 'FAILED' ? 'export_failed' : null,
        startedAt: new Date('2026-11-02T13:00:00Z'),
        finishedAt: new Date('2026-11-02T13:00:04Z'),
      },
    });
  }
}

/** RP-Y10/IP-F19 for client 4: this year collected $450, last year $1,000; QA-1002 owes $300 and
 *  QA-1004 $150 (its card payment voided). Open invoices are due in 2027, never overdue now. */
async function seedInvoices(tx: TxClient, businessId: string, ownerId: string) {
  const clientId = id(4);
  const invoice = async (n: number, number: string, cents: number) => {
    await tx.invoice.create({
      data: { id: id(n), businessId, clientId, number, createdByUserId: ownerId },
    });
    await tx.invoiceLine.create({
      data: {
        businessId,
        invoiceId: id(n),
        description: `QA fixture service (${number})`,
        unitAmountCents: cents,
      },
    });
  };
  const open = (n: number, issuedAt: Date, dueOn: Date) =>
    tx.invoice.update({ where: { id: id(n) }, data: { status: 'OPEN', issuedAt, dueOn } });
  const pay = (n: number, invoiceN: number, data: Record<string, unknown>) =>
    tx.offlinePayment.create({
      data: {
        id: id(n),
        businessId,
        invoiceId: id(invoiceN),
        idempotencyKey: id(n + 50),
        recordedByUserId: ownerId,
        ...(data as { method: 'CHECK'; amountCents: number; receivedOn: Date }),
      },
    });

  await invoice(500, 'QA-1001', 100_000);
  await open(500, new Date('2025-12-15T15:00:00Z'), day('2026-01-14'));
  await pay(510, 500, {
    method: 'CHECK',
    amountCents: 100_000,
    reference: '1001',
    receivedOn: day('2025-12-20'),
  });
  await tx.invoice.update({
    where: { id: id(500) },
    data: { status: 'PAID', paidAt: new Date('2025-12-20T17:00:00Z') },
  });

  await invoice(501, 'QA-1002', 50_000);
  await open(501, new Date('2026-03-02T15:00:00Z'), day('2027-03-31'));
  await pay(511, 501, { method: 'ACH', amountCents: 20_000, receivedOn: day('2026-03-20') });

  // Paid at 23:30 in New York on Oct 31: the firm's Oct 31, already Nov 1 in UTC.
  await invoice(502, 'QA-1003', 25_000);
  await open(502, new Date('2026-10-15T15:00:00Z'), day('2026-11-14'));
  await pay(512, 502, {
    method: 'CASH',
    amountCents: 25_000,
    reference: 'R-1003',
    receivedOn: day('2026-10-31'),
  });
  await tx.invoice.update({
    where: { id: id(502) },
    data: { status: 'PAID', paidAt: new Date('2026-11-01T03:30:00Z') },
  });

  await invoice(503, 'QA-1004', 15_000);
  await open(503, new Date('2026-10-20T15:00:00Z'), day('2027-03-31'));
  await pay(513, 503, { method: 'CARD', amountCents: 15_000, receivedOn: day('2026-10-22') });
  await tx.$queryRawUnsafe(
    'SELECT 1 FROM app_void_offline_payment($1::uuid, $2)',
    id(513),
    'Entered twice',
  );

  await invoice(504, 'QA-1005', 0);
}

/** Firm applications waiting for a decision (approve, decline, request info) and sales records. */
async function seedPlatform(tx: TxClient, adminId: string) {
  const applications = [
    [600, 'QA Harbor Tax (fake)', 'harbor', 'PENDING_REVIEW'],
    [601, 'QA Summit Books (fake)', 'summit', 'PENDING_REVIEW'],
    [602, 'QA Lakeside CPA (fake)', 'lakeside', 'PENDING_REVIEW'],
    [603, 'QA Prairie Advisors (fake)', 'prairie', 'INFO_REQUESTED'],
  ] as const;
  for (const [n, name, key, status] of applications) {
    const email = `owner-${key}@qa.test`;
    await tx.firmApplication.create({
      data: {
        id: id(n),
        legalName: `${name.replace(' (fake)', '')} LLC (fake)`,
        dbaName: name,
        contactName: `QA Owner ${key} (fake)`,
        contactEmail: email,
        contactPhone: '+15555550100',
        data: {
          business: {
            practiceType: 'TAX_ACCOUNTING',
            legalName: `${name.replace(' (fake)', '')} LLC (fake)`,
            dbaName: name,
            entityType: 'LLC',
            email,
            phone: '+15555550100',
            website: null,
            address: {
              line1: '1 QA Street',
              line2: null,
              city: 'Albany',
              state: 'NY',
              postalCode: '12207',
            },
            services: ['TAX_PREPARATION', 'BOOKKEEPING'],
          },
          primaryAdmin: {
            fullName: `QA Owner ${key} (fake)`,
            email,
            phone: '+15555550100',
            title: 'Owner',
            preferredContact: 'EMAIL',
            alternatePhone: null,
          },
          account: {
            requestedPlan: 'PROFESSIONAL',
            teamSize: 3,
            clientVolume: 'UNDER_100',
            heardFrom: 'QA fixture',
            requestedStartDate: null,
            additionalInfo: null,
          },
          credentials: [],
        },
      },
    });
    if (status === 'INFO_REQUESTED') {
      await tx.firmApplication.update({
        where: { id: id(n) },
        data: {
          status,
          reviewedByUserId: adminId,
          reviewedAt: new Date('2026-11-03T15:00:00Z'),
          decisionReason: 'QA fixture: please send the firm license number.',
        },
      });
    }
  }

  const pipeline = await tx.salesPipeline.findUniqueOrThrow({
    where: { systemKey: 'firmivra_default' },
    include: { stages: true },
  });
  const stage = (key: string) => pipeline.stages.find((s) => s.systemKey === key)!.id;
  const deals = [
    [700, 'QA Riverbend Tax (fake)', 'riverbend', 'WEBSITE', null],
    [701, 'QA Oakline Accounting (fake)', 'oakline', 'REFERRAL', 'contacted'],
    [702, 'QA Cedar Ledger (fake)', 'cedar', 'EVENT', 'qualified'],
  ] as const;
  for (const [n, name, key, source, moveTo] of deals) {
    await tx.salesContact.create({
      data: {
        id: id(n),
        name: `QA Contact ${key} (fake)`,
        email: `${key}@qa.test`,
        companyName: name,
        jobTitle: 'Owner',
      },
    });
    await tx.salesOpportunity.create({
      data: {
        id: id(n + 10),
        pipelineId: pipeline.id,
        stageId: stage('new_lead'),
        contactId: id(n),
        title: name,
        companyName: name,
        source,
        valueCents: 120_000,
        assignedToUserId: adminId,
      },
    });
    if (moveTo) {
      await tx.salesOpportunity.update({
        where: { id: id(n + 10) },
        data: { stageId: stage(moveTo) },
      });
    }
  }
  await tx.salesActivity.create({
    data: {
      id: id(720),
      opportunityId: id(711),
      kind: 'CALL',
      direction: 'OUTBOUND',
      outcome: 'CONNECTED',
      occurredAt: new Date('2026-11-03T16:00:00Z'),
      summary: 'QA fixture call: interested in a demo next month.',
    },
  });
  await tx.salesActivity.create({
    data: {
      id: id(721),
      opportunityId: id(712),
      kind: 'EMAIL',
      direction: 'INBOUND',
      outcome: 'REPLIED',
      occurredAt: new Date('2026-11-04T14:00:00Z'),
      summary: 'QA fixture email: asked for pricing for five seats.',
    },
  });
  // Follow-ups far enough ahead that no reminder fires during the reviews.
  await tx.salesFollowUp.create({
    data: {
      id: id(730),
      opportunityId: id(711),
      kind: 'DEMO',
      title: 'QA demo (fake)',
      dueAt: new Date('2099-01-06T15:00:00Z'),
      endsAt: new Date('2099-01-06T15:45:00Z'),
      location: 'Video call',
      assignedToUserId: adminId,
    },
  });
  await tx.salesFollowUp.create({
    data: {
      id: id(731),
      opportunityId: id(712),
      kind: 'CALL',
      title: 'QA pricing call (fake)',
      dueAt: new Date('2099-01-07T15:00:00Z'),
      assignedToUserId: adminId,
    },
  });
}
