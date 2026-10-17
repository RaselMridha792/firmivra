// Demo seed, stage 2 (R0, PART 2): document requests in every status, client uploads answering
// them, last year's filed returns shared with the client (linked to the tax return, for the portal
// Taxes tab), and a couple of internal workpapers. Records only: no file exists behind any of them
// in S3 (same as the LVP seed), so a download shows the app's "file unavailable" state. Every file
// is marked scanned clean once, the way the scanner would.
import { createHash } from 'node:crypto';
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import {
  demoDay,
  demoEngagementId,
  DEMO_ENGAGEMENTS,
  type DemoEngagementSlot,
} from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

type RequestStatus = 'REQUESTED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'NOT_AVAILABLE';

interface DemoRequest {
  key: string;
  clientKey: string;
  title: string;
  category: string;
  status: RequestStatus;
  due: number;
  /** For SUBMITTED, ACCEPTED and REJECTED: the uploaded file's name. */
  file?: string;
  note?: string;
}

const REQUESTS: readonly DemoRequest[] = [
  {
    key: 'r01',
    clientKey: '01',
    title: 'W-2 from your employer',
    category: 'W-2 and 1099',
    status: 'REQUESTED',
    due: 10,
  },
  {
    key: 'r02',
    clientKey: '01',
    title: '1099-INT from your bank',
    category: 'W-2 and 1099',
    status: 'ACCEPTED',
    due: -5,
    file: '1099-INT 2025.pdf',
  },
  {
    key: 'r03',
    clientKey: '01',
    title: 'Photo ID (front and back)',
    category: 'ID',
    status: 'SUBMITTED',
    due: 3,
    file: 'Driver license.jpg',
  },
  {
    key: 'r04',
    clientKey: '02',
    title: 'W-2 from your employer',
    category: 'W-2 and 1099',
    status: 'REQUESTED',
    due: -4,
  },
  {
    key: 'r05',
    clientKey: '02',
    title: 'Brokerage 1099-B',
    category: 'W-2 and 1099',
    status: 'NOT_AVAILABLE',
    due: -2,
    note: 'Client sold no investments in 2025.',
  },
  {
    key: 'r06',
    clientKey: '03',
    title: 'Prior-year return',
    category: 'Prior-year returns',
    status: 'ACCEPTED',
    due: -15,
    file: '2024 Return from prior preparer.pdf',
  },
  {
    key: 'r07',
    clientKey: '08',
    title: 'Mortgage interest statement (1098)',
    category: 'W-2 and 1099',
    status: 'REJECTED',
    due: 2,
    file: '1098 page 1.pdf',
    note: 'Only page 1 came through; please upload all pages.',
  },
  {
    key: 'r08',
    clientKey: '06',
    title: 'W-2 from your employer',
    category: 'W-2 and 1099',
    status: 'SUBMITTED',
    due: 6,
    file: 'W-2 Peachtree Logistics.pdf',
  },
  {
    key: 'r09',
    clientKey: '09',
    title: 'Childcare provider receipts',
    category: 'W-2 and 1099',
    status: 'REQUESTED',
    due: 12,
  },
  {
    key: 'r10',
    clientKey: '12',
    title: 'HSA contributions (5498-SA)',
    category: 'W-2 and 1099',
    status: 'ACCEPTED',
    due: -9,
    file: '5498-SA 2025.pdf',
  },
  {
    key: 'r11',
    clientKey: '04',
    title: 'September bank statement',
    category: 'Bank statements',
    status: 'ACCEPTED',
    due: -20,
    file: 'Operating account Sept.pdf',
  },
  {
    key: 'r12',
    clientKey: '04',
    title: 'October bank statement',
    category: 'Bank statements',
    status: 'REQUESTED',
    due: 8,
  },
  {
    key: 'r13',
    clientKey: '07',
    title: 'Payroll register, Q3',
    category: 'Payroll',
    status: 'SUBMITTED',
    due: 1,
    file: 'Payroll register Q3.xlsx',
  },
  {
    key: 'r14',
    clientKey: '10',
    title: 'Articles of organization',
    category: 'Formation',
    status: 'ACCEPTED',
    due: -30,
    file: 'Articles of organization.pdf',
  },
  {
    key: 'r15',
    clientKey: '13',
    title: 'Credit card statement, September',
    category: 'Bank statements',
    status: 'REQUESTED',
    due: -6,
  },
  {
    key: 'r16',
    clientKey: '15',
    title: 'W-2 from your employer',
    category: 'W-2 and 1099',
    status: 'REQUESTED',
    due: 9,
  },
];

const CONTENT_TYPE = (file: string): string =>
  file.endsWith('.jpg')
    ? 'image/jpeg'
    : file.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

/** The engagement a request belongs to: bookkeeping for business statements, else this year's return. */
const requestSlot = (r: DemoRequest): DemoEngagementSlot => {
  const business = SEED_DEMO_CLIENTS.find((c) => c.key === r.clientKey)!.accountType === 'BUSINESS';
  return business && r.category !== 'Formation' ? 'books' : 'tax2025';
};

export async function seedDemoDocuments(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
  const portalUser = (clientKey: string) =>
    SEED_DEMO_CLIENTS.find((c) => c.key === clientKey)?.portal
      ? demoId(`user:client:${clientKey}`)
      : null;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    const document = async (data: {
      key: string;
      clientKey: string;
      slot: DemoEngagementSlot;
      category: string;
      direction: 'CLIENT_TO_FIRM' | 'FIRM_TO_CLIENT' | 'INTERNAL';
      fileName: string;
      taxYear: number | null;
      uploadedByUserId: string | null;
      requestId?: string;
    }) => {
      const id = demoId(`document:${data.key}`);
      await tx.document.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          clientId: org.clients[data.clientKey]!,
          engagementId: demoEngagementId(data.clientKey, data.slot),
          categoryId: org.categoryIds(data.category),
          requestId: data.requestId ?? null,
          direction: data.direction,
          fileName: data.fileName,
          contentType: CONTENT_TYPE(data.fileName),
          sizeBytes: 40_000 + (Number.parseInt(id.slice(0, 4), 16) % 200_000),
          sha256: createHash('sha256').update(`demo ${data.key}`).digest('hex'),
          s3Key: `tenant/${businessId}/documents/${id}`,
          taxYear: data.taxYear,
          uploadedByUserId: data.uploadedByUserId,
        },
      });
      await tx.document.updateMany({
        where: { id, scanStatus: 'PENDING' },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      return id;
    };

    for (const r of REQUESTS) {
      const slot = requestSlot(r);
      const id = demoId(`document-request:${r.key}`);
      // Every request starts REQUESTED; its file (if any) is uploaded against it, then it moves on.
      await tx.documentRequest.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          clientId: org.clients[r.clientKey]!,
          engagementId: demoEngagementId(r.clientKey, slot),
          categoryId: org.categoryIds(r.category),
          title: r.title,
          instructions: 'Upload a clear copy of every page.',
          dueOn: demoDay(r.due),
          requestedByUserId: user('clientSupport'),
        },
      });
      if (r.file) {
        await document({
          key: `upload:${r.key}`,
          clientKey: r.clientKey,
          slot,
          category: r.category,
          direction: 'CLIENT_TO_FIRM',
          fileName: r.file,
          taxYear: slot === 'tax2025' ? 2025 : null,
          uploadedByUserId: portalUser(r.clientKey),
          requestId: id,
        });
      }
      if (r.status !== 'REQUESTED') {
        await tx.documentRequest.updateMany({
          where: { id, status: 'REQUESTED' },
          data: {
            status: r.status,
            ...(r.note ? { statusNote: r.note } : {}),
            ...(r.status === 'ACCEPTED' || r.status === 'NOT_AVAILABLE'
              ? { resolvedAt: demoDay(r.due) }
              : {}),
          },
        });
      }
    }

    // Last year's filed returns, shared with the client and linked to the tax return.
    for (const e of DEMO_ENGAGEMENTS) {
      if (e.slot !== 'tax2024') continue;
      const docId = await document({
        key: `return:${e.clientKey}:2024`,
        clientKey: e.clientKey,
        slot: 'tax2024',
        category: 'Final return',
        direction: 'FIRM_TO_CLIENT',
        fileName: '2024 Form 1040 - Filed.pdf',
        taxYear: 2024,
        uploadedByUserId: user('taxPreparer'),
      });
      await tx.taxReturn.updateMany({
        where: { id: demoId(`tax-return:${e.clientKey}:2024`), documentId: null },
        data: { documentId: docId },
      });
    }

    // Internal workpapers the client never sees.
    await document({
      key: 'workpaper:01',
      clientKey: '01',
      slot: 'tax2025',
      category: 'Prior-year returns',
      direction: 'INTERNAL',
      fileName: 'Carryover worksheet.xlsx',
      taxYear: 2025,
      uploadedByUserId: user('manager'),
    });
    await document({
      key: 'workpaper:10',
      clientKey: '10',
      slot: 'books',
      category: 'Bank statements',
      direction: 'INTERNAL',
      fileName: 'September reconciliation.xlsx',
      taxYear: null,
      uploadedByUserId: user('bookkeeper'),
    });
  });
}
