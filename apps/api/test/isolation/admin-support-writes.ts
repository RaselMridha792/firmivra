// R60: the Super Admin Support writes for admin-scope.test.ts, each against a record of its own
// (tickets, a category, a priority, a holiday, a canned response) so every write meets something
// it can change. Files go to an in-memory store (the test overrides DOCUMENT_STORAGE with it).
import { createHash, randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { UploadTicket } from '@firmivra/types';
import type { Fixtures } from '../global-setup.js';
import type { DocumentStorage } from '../../src/storage/document-storage.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

export class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  head(key: string, { checksum = false } = {}) {
    const b = this.objects.get(key);
    return Promise.resolve(
      b
        ? { sizeBytes: b.length, sha256: checksum ? sha256(b) : null, contentEncoding: null }
        : null,
    );
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
export const supportStorage = new MemoryStorage();

/** What a write case may use to build its body (an upload first, for files). */
export interface WriteHelpers {
  post(path: string, body: object): Promise<{ status: number; body: unknown }>;
}
export interface SupportWrite {
  body: object | ((h: WriteHelpers) => Promise<object>);
  /** The support record its `:id` is (a key of the prepared records). */
  record?: string;
  query?: string;
}

/** Record ids by key, shared with the other admin write helpers (admin-billing-writes.ts). */
export const records: Record<string, string> = {};
const refs: { categoryId: string; priorityId: string; highId: string; criticalId: string } = {
  categoryId: '',
  priorityId: '',
  highId: '',
  criticalId: '',
};
export const supportRecord = (key: string) => records[key];

/** The records the writes act on, and the support roles the permission grid is stored on. */
export async function prepareSupport(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const tag = randomUUID().slice(0, 8);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const priorities = await tx.supportPriority.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      const categories = await tx.supportCategory.findMany({ where: { isActive: true }, take: 1 });
      refs.categoryId = categories[0]!.id;
      refs.priorityId = priorities[priorities.length - 1]!.id;
      refs.highId = priorities.find((p) => p.code === 'HIGH')?.id ?? priorities[0]!.id;
      refs.criticalId = priorities.find((p) => p.code === 'CRITICAL')?.id ?? priorities[0]!.id;
      for (const key of [
        'patch',
        'delete',
        'assign',
        'escalate',
        'mergeTarget',
        'mergeSource',
        'reply',
        'files',
      ]) {
        const t = await tx.supportTicket.create({
          data: {
            businessId: fx.firmA.id,
            contactUserId: fx.users.ownerA.id,
            subject: `Fake scope ticket ${key}`,
            description: 'Fake',
            categoryId: refs.categoryId,
            priorityId: refs.priorityId,
            source: 'INTERNAL',
            createdByUserId: fx.users.admin.id,
          },
        });
        records[key] = t.id;
      }
      records.category = (
        await tx.supportCategory.create({ data: { name: `Fake scope ${tag}` } })
      ).id;
      records.priority = (
        await tx.supportPriority.create({
          data: {
            code: `SCOPE_${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
            name: `Fake scope ${tag}`,
            color: '#2563EB',
            responseTargetMinutes: 120,
            sortOrder: 90,
          },
        })
      ).id;
      records.holiday = (
        await tx.supportHoliday.create({
          data: {
            date: new Date(Date.UTC(2040, 0, 2 + (parseInt(tag, 16) % 300))),
            name: 'Fake scope day',
          },
        })
      ).id;
      records.canned = (
        await tx.supportCannedResponse.create({
          data: { title: 'Fake scope reply', body: 'Fake', createdByUserId: fx.users.admin.id },
        })
      ).id;
      // The roles the support permission grid is stored on (seed-platform-team.ts codes).
      const dept = async (code: string, name: string) =>
        tx.platformDepartment.upsert({ where: { code }, create: { code, name }, update: {} });
      const exec = await dept('EXECUTIVE', 'Executive');
      const support = await dept('CUSTOMER_SUCCESS_SUPPORT', 'Customer Success / Support');
      for (const [code, title, level, departmentId] of [
        ['EXECUTIVE_CEO', 'CEO', 'CEO', exec.id],
        [
          'CUSTOMER_SUCCESS_SUPPORT_CUSTOMER_SUPPORT_MANAGER',
          'Customer Support Manager',
          'MANAGER',
          support.id,
        ],
        [
          'CUSTOMER_SUCCESS_SUPPORT_CUSTOMER_SUPPORT_REPRESENTATIVE',
          'Customer Support Representative',
          'INDIVIDUAL_CONTRIBUTOR',
          support.id,
        ],
      ] as const) {
        await tx.platformRoleDefinition.upsert({
          where: { code },
          create: {
            code,
            title,
            level,
            departmentId,
            defaultScopeType: level === 'CEO' ? 'COMPANY' : 'TEAM',
          },
          update: {},
        });
      }
    });
  } finally {
    await owner.$disconnect();
  }
}

const S = '/api/v1/admin/support';
const days = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: day >= 1 && day <= 5,
  start: '09:00',
  end: '17:00',
}));

/** Each Support write with a body that passes validation, in the order the sweep runs them. */
export function supportWrites(fx: Fixtures): Record<string, SupportWrite> {
  const upload = async (h: WriteHelpers) => {
    const res = await h.post(`${S}/uploads`, {
      firmId: fx.firmA.id,
      fileName: 'scope.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
    });
    const ticket = res.body as UploadTicket;
    supportStorage.put(ticket, PDF);
    return ticket.uploadToken;
  };
  return {
    [`POST ${S}/uploads`]: {
      body: {
        firmId: fx.firmA.id,
        fileName: 'scope.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: sha256(PDF),
      },
    },
    [`POST ${S}/tickets`]: {
      body: () =>
        Promise.resolve({
          requestId: randomUUID(),
          firmId: fx.firmA.id,
          contactId: fx.users.ownerA.id,
          subject: 'Fake scope ticket',
          categoryId: refs.categoryId,
          priorityId: refs.priorityId,
          assignTo: 'QUEUE',
          status: 'OPEN',
          source: 'INTERNAL',
          description: 'Fake',
        }),
    },
    [`PATCH ${S}/tickets/:id`]: { record: 'patch', body: { version: 1, status: 'IN_PROGRESS' } },
    [`DELETE ${S}/tickets/:id`]: { record: 'delete', body: {}, query: '?version=1' },
    [`POST ${S}/tickets/:id/assign`]: {
      record: 'assign',
      body: { version: 1, assignTo: fx.users.admin.id },
    },
    [`POST ${S}/tickets/:id/escalate`]: {
      record: 'escalate',
      body: { version: 1, reason: 'Fake reason' },
    },
    [`POST ${S}/tickets/:id/merge`]: {
      record: 'mergeTarget',
      body: () => Promise.resolve({ version: 1, sourceId: records.mergeSource }),
    },
    [`POST ${S}/tickets/:id/replies`]: {
      record: 'reply',
      body: { mode: 'NOTE', body: 'Fake note' },
    },
    [`POST ${S}/tickets/:id/attachments`]: {
      record: 'files',
      body: async (h) => ({ uploadTokens: [await upload(h)] }),
    },
    [`POST ${S}/settings/categories`]: {
      body: () => Promise.resolve({ name: `Fake scope ${randomUUID().slice(0, 8)}` }),
    },
    [`PATCH ${S}/settings/categories/:id`]: {
      record: 'category',
      body: () => Promise.resolve({ name: `Fake scope ${randomUUID().slice(0, 8)}` }),
    },
    [`PUT ${S}/settings/categories/:id/active`]: { record: 'category', body: { active: true } },
    [`POST ${S}/settings/priorities`]: {
      body: () =>
        Promise.resolve({
          name: `Fake ${randomUUID().slice(0, 8)}`,
          color: 'blue',
          target: { amount: 2, unit: 'HOURS' },
        }),
    },
    [`PATCH ${S}/settings/priorities/:id`]: {
      record: 'priority',
      body: () =>
        Promise.resolve({
          name: `Fake ${randomUUID().slice(0, 8)}`,
          color: 'green',
          target: { amount: 3, unit: 'HOURS' },
        }),
    },
    [`PUT ${S}/settings/priorities/:id/active`]: { record: 'priority', body: { active: true } },
    [`PUT ${S}/settings/business-hours`]: {
      body: { timeZone: 'America/New_York', days, clock: 'BUSINESS' },
    },
    [`POST ${S}/settings/holidays`]: {
      body: () =>
        Promise.resolve({
          date: new Date(Date.UTC(2045, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000)
            .toISOString()
            .slice(0, 10),
          name: 'Fake scope holiday',
        }),
    },
    [`DELETE ${S}/settings/holidays/:id`]: { record: 'holiday', body: {} },
    [`PUT ${S}/settings/assignment`]: {
      body: { defaultQueue: true, roundRobin: false, reassign: false, reassignAfterHours: 4 },
    },
    [`PUT ${S}/settings/escalation`]: {
      body: () =>
        Promise.resolve({
          slaBreach: { enabled: true, notify: 'ADMINS' },
          highPriority: {
            enabled: true,
            priorityId: refs.highId,
            target: { amount: 1, unit: 'BUSINESS_DAYS' },
          },
          critical: {
            enabled: true,
            priorityId: refs.criticalId,
            channels: ['EMAIL', 'IN_APP', 'SMS'],
          },
        }),
    },
    [`POST ${S}/settings/canned-responses`]: { body: { title: 'Fake scope reply', body: 'Fake' } },
    [`PATCH ${S}/settings/canned-responses/:id`]: {
      record: 'canned',
      body: { title: 'Fake scope reply 2', body: 'Fake' },
    },
    [`PUT ${S}/settings/canned-responses/:id/active`]: { record: 'canned', body: { active: true } },
    [`PUT ${S}/settings/notifications`]: {
      body: { channels: ['IN_APP'], rules: [{ event: 'NEW_TICKET', recipients: ['ADMINS'] }] },
    },
    [`PUT ${S}/settings/permissions`]: {
      body: {
        OWNER: [
          'VIEW_ALL',
          'VIEW_OWN',
          'ASSIGN',
          'ESCALATE',
          'RESOLVE',
          'CLOSE',
          'MERGE',
          'EDIT_SETTINGS',
          'DELETE',
          'VIEW_INTERNAL_NOTES',
          'MANAGE_CANNED',
        ],
        LEAD: [
          'VIEW_ALL',
          'VIEW_OWN',
          'ASSIGN',
          'ESCALATE',
          'RESOLVE',
          'CLOSE',
          'MERGE',
          'VIEW_INTERNAL_NOTES',
          'MANAGE_CANNED',
        ],
        AGENT: ['VIEW_OWN', 'ESCALATE', 'RESOLVE', 'VIEW_INTERNAL_NOTES'],
      },
    },
  };
}
