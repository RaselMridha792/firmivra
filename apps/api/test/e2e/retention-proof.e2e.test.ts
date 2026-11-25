// End-to-end proof for Intake Forms Review Two 14b (I3b, the timed-jobs half): reaching a
// retention minimum removes nothing. Octavia's approved rule: the clock starts when the
// associated job or task is completed, and after the minimum ends the information stays in the
// database; there is no automatic deletion or archiving. R1's RetentionGuard and the Security
// panel prove the settings and that no removal path exists; this file proves that no timed job
// removes anything either.
//
// Two firms, each with records in the six categories on a job (engagement) completed on
// 2020-01-15 and on an open one, and on a completed and an open task:
// - client-sent documents (CLIENT_TO_FIRM), one in Trash (restorable);
// - company-sent documents (FIRM_TO_CLIENT), one archived;
// - tax return documents (a document behind tax_return_documents);
// - submitted intake forms (SUBMITTED, COMPLETED and ARCHIVED, each with its signed submission);
// - portal messages (threads on the engagement and on the task, with messages both ways);
// - system-sent emails (notification_deliveries, EMAIL, SENT).
// Every document has its object in the (in-memory) document storage.
//
// Then every timed job of the API runs for both firms with "now" at 2060-01-15, completion plus
// 40 years, past any minimum (at most 30 years): `now` is passed to each job that takes it, and
// JavaScript's clock is faked to the same instant for the rest (vitest fakes Date only; the
// database's own now() stays real). The counts per firm, every seeded row and every stored
// object are the same afterwards, and storage is never asked to remove a seeded object. A guard
// test fails when a new timed job (a setInterval in apps/api/src) is not in this proof.
// Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { ANNUAL_TAX_FORM, type UploadTicket } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { WaitlistJob } from '../../src/appointments/waitlist.job.js';
import { AutomationJob } from '../../src/automations/automation.job.js';
import { BeginOnlineSweep } from '../../src/begin-online/begin-online-sweep.js';
import { CommunicationDelivery } from '../../src/communications/communications-delivery.service.js';
import { loadEnv } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { CrmNurtureSender } from '../../src/crm/crm-nurture.job.js';
import { EsignBulkJob } from '../../src/esign/bulk/bulk.job.js';
import { EsignCompletionJob } from '../../src/esign/completion/completion.job.js';
import { EsignLifecycleJob } from '../../src/esign/lifecycle/lifecycle.job.js';
import { FirmKeyJob } from '../../src/firm-applications/firm-key-job.js';
import {
  INTAKE_JOB_LOCK_KEYS,
  type IntakeJob,
  IntakeScheduleJobs,
} from '../../src/intake-workspace/intake-schedule.jobs.js';
import { LocationActionsJob } from '../../src/locations/location-actions.job.js';
import { TaskAckReminderJob } from '../../src/tasks/task-ack-reminder.job.js';
import { OutboundMessagesJob } from '../../src/messages/outbound.job.js';
import {
  JOB_LOCK_KEYS,
  type ReminderJob,
  ReminderJobs,
} from '../../src/notifications/reminder-jobs.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { InvoiceJobs } from '../../src/payments/invoices/invoice-jobs.js';
import { PlatformRollupJob } from '../../src/platform-rollups/rollups.job.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type FileFacts,
} from '../../src/storage/document-storage.js';
import { TaskSeriesJob } from '../../src/tasks/task-series.job.js';
import { MemoryUploads } from '../memory-uploads.js';

/** The in-memory storage of the documents, which remembers every key it was asked to remove. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new MemoryUploads(this.objects);
  readonly removed: string[] = [];
  presignUpload(file: FileFacts) {
    return this.uploads.presign(file);
  }
  completeUpload(key: string, uploadId: string, sizeBytes: number) {
    return this.uploads.complete(key, uploadId, sizeBytes);
  }
  abortUpload(key: string, uploadId: string) {
    return this.uploads.abort(key, uploadId);
  }
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: null, contentEncoding: null } : null);
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.removed.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadTicket, bytes: Buffer) {
    this.uploads.send(ticket, bytes);
  }
}
const storage = new MemoryStorage();
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
/** When the completed job and task were completed. */
const DONE_AT = new Date('2020-01-15T15:00:00.000Z');
/** When everything was made (before the completion). */
const MADE_AT = new Date('2019-06-01T15:00:00.000Z');
/** Completion plus 40 years: past any retention minimum (at most 30 years). */
const LATER = new Date('2060-01-15T15:00:00.000Z');

/** The firm-wide agreement a submission signs (the database checks every current one). */
const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment.', required: true },
];

type FirmKey = 'a' | 'b';
const firms = {} as Record<FirmKey, string>;
const people = {} as Record<FirmKey, { owner: string; client: string }>;
/** Every seeded row, by table, per firm: they must all still be there, unchanged. */
const seeded = {} as Record<FirmKey, Seeded>;
interface Seeded {
  documents: string[];
  taxReturnDocuments: string[];
  intakes: string[];
  submissions: string[];
  threads: string[];
  messages: string[];
  deliveries: string[];
  keys: string[];
}

let app: INestApplication;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: FirmKey, work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** One document with its stored object. */
async function document(
  tx: TxClient,
  s: Seeded,
  data: {
    businessId: string;
    clientId: string;
    engagementId: string;
    direction: 'CLIENT_TO_FIRM' | 'FIRM_TO_CLIENT';
    uploadedByUserId: string;
    trashed?: boolean;
    archived?: boolean;
  },
): Promise<string> {
  const tag = randomUUID();
  const s3Key = `tenant/${data.businessId}/retention-proof/${tag}/fake.pdf`;
  const bytes = Buffer.from(`%PDF-1.4 fake ${tag}`);
  const row = await tx.document.create({
    data: {
      businessId: data.businessId,
      clientId: data.clientId,
      engagementId: data.engagementId,
      direction: data.direction,
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha(tag),
      s3Key,
      uploadedByUserId: data.uploadedByUserId,
      createdAt: MADE_AT,
    },
    select: { id: true },
  });
  // As the scanner, then staff, would: clean, then in Trash or archived.
  await tx.document.update({
    where: { id: row.id },
    data: { scanStatus: 'CLEAN', scannedAt: MADE_AT },
  });
  if (data.trashed || data.archived) {
    await tx.document.update({
      where: { id: row.id },
      data: data.trashed ? { trashedAt: DONE_AT } : { archivedAt: DONE_AT },
    });
  }
  storage.objects.set(s3Key, bytes);
  s.documents.push(row.id);
  s.keys.push(s3Key);
  return row.id;
}

/** An intake the client signed and sent, then left in `status`. */
async function submittedIntake(
  tx: TxClient,
  s: Seeded,
  ctx: { businessId: string; formId: string; engagementId: string; clientUserId: string },
  status: 'SUBMITTED' | 'COMPLETED' | 'ARCHIVED',
): Promise<void> {
  const intake = await tx.intake.create({
    data: {
      businessId: ctx.businessId,
      formId: ctx.formId,
      engagementId: ctx.engagementId,
      status: 'IN_PROGRESS',
      sentAt: MADE_AT,
    },
    select: { id: true },
  });
  const draft = await tx.intakeSubmission.create({
    data: {
      businessId: ctx.businessId,
      intakeId: intake.id,
      version: 1,
      answers: { firstName: 'Fake' },
    },
    select: { id: true },
  });
  const versions = (
    await tx.firmAgreement.findMany({
      where: { businessId: ctx.businessId, archivedAt: null },
      select: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    })
  ).flatMap((a) => a.versions);
  const account = await tx.clientAccount.findFirstOrThrow({
    where: { businessId: ctx.businessId, userId: ctx.clientUserId },
    select: { id: true, userId: true },
  });
  // As the client's own login (the database checks the actor), as the portal's sign() does.
  await tx.$executeRaw`SELECT set_config('app.current_actor_id', ${account.userId}, true)`;
  const sig = await tx.intakeSignature.create({
    data: {
      businessId: ctx.businessId,
      submissionId: draft.id,
      intakeId: intake.id,
      clientAccountId: account.id,
      printedName: 'Fake Client',
      signatureText: 'Fake Client',
      acknowledgments: versions.flatMap((v) =>
        (v.acknowledgments as typeof ACKS).map((a) => ({
          agreementVersionId: v.id,
          ...a,
          checked: true,
        })),
      ),
      answersSha256: '0'.repeat(64),
      evidenceSha256: sha(randomUUID()),
      agreements: {
        create: versions.map((v) => ({
          agreementVersionId: v.id,
          bodySha256: v.bodySha256,
          pdfSha256: v.pdfSha256,
        })),
      },
    },
  });
  await tx.$executeRaw`SELECT set_config('app.current_actor_id', '', true)`;
  await tx.intakeSubmission.update({
    where: { id: draft.id },
    data: { submittedAt: MADE_AT, signerName: sig.printedName, signedAt: sig.signedAt },
  });
  await tx.intake.update({ where: { id: intake.id }, data: { status: 'SUBMITTED' } });
  if (status === 'COMPLETED') {
    await tx.intake.update({
      where: { id: intake.id },
      data: { status: 'COMPLETED', completedAt: DONE_AT },
    });
  } else if (status === 'ARCHIVED') {
    await tx.intake.update({ where: { id: intake.id }, data: { status: 'ARCHIVED' } });
  }
  s.intakes.push(intake.id);
  s.submissions.push(draft.id);
}

/** A portal thread with a message each way. */
async function thread(
  tx: TxClient,
  s: Seeded,
  ctx: { businessId: string; clientId: string; ownerId: string; clientUserId: string },
  on: { engagementId: string } | { taskId: string },
): Promise<void> {
  const row = await tx.messageThread.create({
    data: {
      businessId: ctx.businessId,
      clientId: ctx.clientId,
      subject: 'Fake subject',
      createdByUserId: ctx.ownerId,
      createdAt: MADE_AT,
      ...('engagementId' in on
        ? { engagementId: on.engagementId }
        : { entityType: 'task', entityId: on.taskId }),
    },
    select: { id: true },
  });
  s.threads.push(row.id);
  for (const [senderUserId, direction] of [
    [ctx.ownerId, 'FIRM_TO_CLIENT'],
    [ctx.clientUserId, 'CLIENT_TO_FIRM'],
  ] as const) {
    const m = await tx.message.create({
      data: {
        businessId: ctx.businessId,
        threadId: row.id,
        senderUserId,
        direction,
        body: 'Fake message',
        createdAt: MADE_AT,
      },
      select: { id: true },
    });
    s.messages.push(m.id);
  }
}

/** A notification to the client, emailed (a system-sent email). */
async function sentEmail(
  tx: TxClient,
  s: Seeded,
  ctx: { businessId: string; clientUserId: string },
  entity: { entityType: string; entityId: string },
): Promise<void> {
  const n = await tx.notification.create({
    data: {
      businessId: ctx.businessId,
      recipientUserId: ctx.clientUserId,
      category: 'SERVICES',
      type: 'engagement.updated',
      ...entity,
      createdAt: MADE_AT,
    },
    select: { id: true },
  });
  const d = await tx.notificationDelivery.create({
    data: {
      businessId: ctx.businessId,
      notificationId: n.id,
      channel: 'EMAIL',
      createdAt: MADE_AT,
    },
    select: { id: true },
  });
  // Queued, then sent, as the outbox does.
  await tx.notificationDelivery.update({
    where: { id: d.id },
    data: { status: 'SENT', attempts: 1, sentAt: MADE_AT },
  });
  s.deliveries.push(d.id);
}

async function seedFirm(firm: FirmKey): Promise<void> {
  const businessId = firms[firm];
  const { owner, client: clientUserId } = people[firm];
  const s: Seeded = {
    documents: [],
    taxReturnDocuments: [],
    intakes: [],
    submissions: [],
    threads: [],
    messages: [],
    deliveries: [],
    keys: [],
  };
  seeded[firm] = s;
  await inFirm(firm, async (tx) => {
    await tx.membership.create({
      data: { businessId, userId: owner, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({
      data: { businessId, displayName: `Fake Client ${firm}`, email: `c-${firm}-${run}@r56.test` },
      select: { id: true },
    });
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: clientUserId,
        clientId: client.id,
        email: `c-${firm}-${run}@r56.test`,
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Annual tax ${run}` },
      select: { id: true },
    });
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: ANNUAL_TAX_FORM.title,
        definition: ANNUAL_TAX_FORM,
        status: 'PUBLISHED',
        publishedAt: MADE_AT,
      },
      select: { id: true },
    });
    const agreement = await tx.firmAgreement.create({
      data: { businessId, scope: 'ALL_INTAKES', createdByUserId: owner },
      select: { id: true },
    });
    await tx.firmAgreementVersion.create({
      data: {
        businessId,
        agreementId: agreement.id,
        version: 1,
        title: 'Fake intake agreement',
        bodyMarkdown: '# Fake intake agreement\n\nNot legal text.',
        acknowledgments: ACKS,
        publishedByUserId: owner,
      },
    });
    const ctx = { businessId, clientId: client.id, ownerId: owner, clientUserId };

    // The completed job and the open one, each with a completed and an open task.
    for (const done of [true, false]) {
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId: client.id,
          serviceId: service.id,
          title: `Fake ${done ? '2019' : '2025'} return`,
          taxYear: done ? 2019 : 2025,
          createdAt: MADE_AT,
        },
        select: { id: true },
      });
      const engagementId = engagement.id;
      const tasks = [];
      for (const taskDone of [true, false]) {
        tasks.push(
          await tx.task.create({
            data: {
              businessId,
              clientId: client.id,
              engagementId,
              title: `Fake ${taskDone ? 'done' : 'open'} task`,
              createdAt: MADE_AT,
              ...(taskDone ? { status: 'DONE' as const, completedAt: DONE_AT } : {}),
            },
            select: { id: true },
          }),
        );
      }

      // Client-sent (one in Trash) and company-sent (one archived).
      const docs = { businessId, clientId: client.id, engagementId };
      await document(tx, s, {
        ...docs,
        direction: 'CLIENT_TO_FIRM',
        uploadedByUserId: clientUserId,
      });
      await document(tx, s, {
        ...docs,
        direction: 'CLIENT_TO_FIRM',
        uploadedByUserId: clientUserId,
        trashed: true,
      });
      await document(tx, s, { ...docs, direction: 'FIRM_TO_CLIENT', uploadedByUserId: owner });
      await document(tx, s, {
        ...docs,
        direction: 'FIRM_TO_CLIENT',
        uploadedByUserId: owner,
        archived: true,
      });

      // A tax return of the job with its filed return.
      const taxReturn = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: client.id,
          engagementId,
          taxYear: done ? 2019 : 2025,
          filingType: 'INDIVIDUAL',
        },
        select: { id: true },
      });
      const filed = await document(tx, s, {
        ...docs,
        direction: 'FIRM_TO_CLIENT',
        uploadedByUserId: owner,
      });
      const link = await tx.taxReturnDocument.create({
        data: {
          businessId,
          taxReturnId: taxReturn.id,
          documentId: filed,
          kind: 'FILED_RETURN',
          createdByUserId: owner,
        },
        select: { id: true },
      });
      s.taxReturnDocuments.push(link.id);

      // Submitted intake forms in each kept status.
      for (const status of ['SUBMITTED', 'COMPLETED', 'ARCHIVED'] as const) {
        await submittedIntake(
          tx,
          s,
          { businessId, formId: form.id, engagementId, clientUserId },
          status,
        );
      }

      // Portal messages on the job and on each task.
      await thread(tx, s, ctx, { engagementId });
      for (const task of tasks) await thread(tx, s, ctx, { taskId: task.id });

      // System-sent emails about the job and each task.
      await sentEmail(tx, s, ctx, { entityType: 'engagement', entityId: engagementId });
      for (const task of tasks) {
        await sentEmail(tx, s, ctx, { entityType: 'task', entityId: task.id });
      }

      // Completed once its records were in, as a real job is (an open job takes uploads).
      if (done) {
        await tx.engagement.update({
          where: { id: engagementId },
          data: { status: 'COMPLETED', completedAt: DONE_AT },
        });
      }
    }
  });
}

/** The six categories' counts at a firm, and the seeded rows as they are. */
async function snapshot(firm: FirmKey) {
  const s = seeded[firm];
  return inFirm(firm, async (tx) => {
    const businessId = firms[firm];
    const counts = {
      clientSent: await tx.document.count({
        where: { businessId, direction: 'CLIENT_TO_FIRM', taxReturnDocuments: { none: {} } },
      }),
      companySent: await tx.document.count({
        where: { businessId, direction: 'FIRM_TO_CLIENT', taxReturnDocuments: { none: {} } },
      }),
      taxReturnDocuments: await tx.document.count({
        where: { businessId, taxReturnDocuments: { some: {} } },
      }),
      taxReturnDocumentLinks: await tx.taxReturnDocument.count({ where: { businessId } }),
      submittedIntakes: await tx.intake.count({
        where: { businessId, status: { in: ['SUBMITTED', 'COMPLETED', 'ARCHIVED'] } },
      }),
      submittedSubmissions: await tx.intakeSubmission.count({
        where: { businessId, submittedAt: { not: null } },
      }),
      threads: await tx.messageThread.count({ where: { businessId } }),
      messages: await tx.message.count({ where: { businessId } }),
      sentEmails: await tx.notificationDelivery.count({ where: { businessId } }),
    };
    const rows = {
      documents: await tx.document.findMany({
        where: { id: { in: s.documents } },
        orderBy: { id: 'asc' },
        select: { id: true, s3Key: true, trashedAt: true, archivedAt: true, direction: true },
      }),
      taxReturnDocuments: await tx.taxReturnDocument.findMany({
        where: { id: { in: s.taxReturnDocuments } },
        orderBy: { id: 'asc' },
        select: { id: true, documentId: true },
      }),
      intakes: await tx.intake.findMany({
        where: { id: { in: s.intakes } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true },
      }),
      submissions: await tx.intakeSubmission.findMany({
        where: { id: { in: s.submissions } },
        orderBy: { id: 'asc' },
        select: { id: true, submittedAt: true, answers: true },
      }),
      threads: await tx.messageThread.findMany({
        where: { id: { in: s.threads } },
        orderBy: { id: 'asc' },
        select: { id: true, archivedAt: true },
      }),
      messages: await tx.message.findMany({
        where: { id: { in: s.messages } },
        orderBy: { id: 'asc' },
        select: { id: true, body: true },
      }),
      deliveries: await tx.notificationDelivery.findMany({
        where: { id: { in: s.deliveries } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true },
      }),
    };
    return { counts, rows };
  });
}

/** Every timed job of the API, run once for both firms at LATER. */
function timedJobs(businessIds: string[]): [string, () => Promise<unknown>][] {
  const now = LATER;
  const job = <T>(type: new (...args: never[]) => T): T => app.get(type, { strict: false });
  return [
    ...(Object.keys(INTAKE_JOB_LOCK_KEYS) as IntakeJob[]).map(
      (key): [string, () => Promise<unknown>] => [
        `intake schedule: ${key}`,
        () => job(IntakeScheduleJobs).run(key, { now, businessIds }),
      ],
    ),
    ...(Object.keys(JOB_LOCK_KEYS) as ReminderJob[]).map(
      (key): [string, () => Promise<unknown>] => [
        `reminders: ${key}`,
        () => job(ReminderJobs).run(key, { now, businessIds }),
      ],
    ),
    ['Begin Online draft sweep', () => job(BeginOnlineSweep).run({ businessIds })],
    ['outbound messages', () => job(OutboundMessagesJob).run({ now, businessIds })],
    ['communications delivery', () => job(CommunicationDelivery).run({ now, businessIds })],
    ['automations', () => job(AutomationJob).run({ now, businessIds })],
    ['task series', () => job(TaskSeriesJob).run({ now, businessIds })],
    ['appointment waitlist', () => job(WaitlistJob).run({ now, businessIds })],
    ['invoices', () => job(InvoiceJobs).run({ now, businessIds })],
    ['e-sign bulk', () => job(EsignBulkJob).run({ businessIds })],
    ['e-sign completion', () => job(EsignCompletionJob).run({ now, businessIds })],
    ['e-sign lifecycle', () => job(EsignLifecycleJob).run({ now, businessIds })],
    ['location actions', () => job(LocationActionsJob).run({ businessIds })],
    ['platform rollups', () => job(PlatformRollupJob).run({ now, businessIds })],
    // Q36: it only marks an acknowledgment's reminder sent; nothing is removed.
    ['task acknowledgment reminders', () => job(TaskAckReminderJob).run({ now, businessIds })],
    ['firm keys', () => job(FirmKeyJob).sweep()],
    // Q35: platform CRM steps only (no firm data); none of another test file's journeys.
    ['CRM nurture sender', () => job(CrmNurtureSender).run({ now, journeyIds: [] })],
  ];
}

/** The source files of every timed job this proof runs (relative to apps/api/src). */
const JOB_FILES = [
  'appointments/waitlist.job.ts',
  'automations/automation.job.ts',
  'begin-online/begin-online-sweep.ts',
  'communications/communications-delivery.service.ts',
  'crm/crm-nurture.job.ts',
  'esign/bulk/bulk.job.ts',
  'esign/completion/completion.job.ts',
  'esign/lifecycle/lifecycle.job.ts',
  'firm-applications/firm-key-job.ts',
  'intake-workspace/intake-schedule.jobs.ts',
  'locations/location-actions.job.ts',
  'messages/outbound.job.ts',
  'notifications/reminder-jobs.ts',
  'payments/invoices/invoice-jobs.ts',
  'platform-rollups/rollups.job.ts',
  'tasks/task-ack-reminder.job.ts',
  'tasks/task-series.job.ts',
];

beforeAll(async () => {
  const keys: FirmKey[] = ['a', 'b'];
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const firm of keys) {
      const slug = `r56-ret-${firm}-${run}`;
      firms[firm] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
      const user = async (pool: 'STAFF' | 'CLIENT', who: string) => {
        const id = randomUUID();
        await tx.user.create({
          data: {
            id,
            cognitoSub: id,
            pool,
            email: `${who}-${firm}-${run}@r56.test`,
            name: `Fake ${who}`,
          },
        });
        return id;
      };
      people[firm] = {
        owner: await user('STAFF', 'owner'),
        client: await user('CLIENT', 'client'),
      };
    }
  });
  for (const firm of keys) await seedFirm(firm);

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
});

describe('Intake 14b: reaching a retention minimum removes nothing (I3b)', () => {
  it('every timed job of the API is in this proof', () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && readFileSync(path, 'utf8').includes('setInterval(')) {
          found.push(relative(src, path).replaceAll('\\', '/'));
        }
      }
    };
    walk(src);
    // A new timed job: add it to timedJobs() and JOB_FILES.
    expect(found.sort()).toEqual([...JOB_FILES].sort());
  });

  it('every timed job, run 40 years after the job was completed, leaves the six categories as they were', async () => {
    const before = { a: await snapshot('a'), b: await snapshot('b') };
    // The seeds are what the proof says they are: each category is there on both firms.
    for (const firm of ['a', 'b'] as const) {
      expect(before[firm].counts).toEqual({
        clientSent: 4,
        companySent: 4,
        taxReturnDocuments: 2,
        taxReturnDocumentLinks: 2,
        submittedIntakes: 6,
        submittedSubmissions: 6,
        threads: 6,
        messages: 12,
        sentEmails: 6,
      });
      expect(before[firm].rows.documents).toHaveLength(10);
      expect(before[firm].rows.documents.filter((d) => d.trashedAt)).toHaveLength(2);
    }
    const objects = new Map(storage.objects);

    vi.useFakeTimers({ toFake: ['Date'], now: LATER });
    const ran: string[] = [];
    const skipped = (result: unknown) =>
      (result as { skipped?: unknown } | undefined)?.skipped === true;
    try {
      for (const [name, runJob] of timedJobs([firms.a, firms.b])) {
        // A job skips while another test file's run holds its lock (one database): try again.
        let result = await runJob();
        for (let i = 0; skipped(result) && i < 40; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          result = await runJob();
        }
        expect(skipped(result), `${name} never got its lock`).toBe(false);
        ran.push(name);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(ran).toHaveLength(timedJobs([]).length);

    for (const firm of ['a', 'b'] as const) {
      expect(await snapshot(firm), `firm ${firm}`).toEqual(before[firm]);
      for (const key of seeded[firm].keys) {
        expect(storage.objects.get(key), key).toEqual(objects.get(key));
        expect(await app.get<DocumentStorage>(DOCUMENT_STORAGE).head(key), key).not.toBeNull();
      }
    }
    const keys = [...seeded.a.keys, ...seeded.b.keys];
    expect(storage.removed.filter((k) => keys.includes(k))).toEqual([]);
  });
});
