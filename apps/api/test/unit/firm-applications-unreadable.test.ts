// FirmApplicationsService with a stubbed database: an application whose stored form can't be read
// is logged with its id only, wherever it is read (hard rule 4). The e2e tests run with the logger
// off, so they can't see what is logged. Also an older stored form that still has the EIN's last 4,
// which R0's #80 refuses in the database, so only a stub can hold it.
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmApplication } from '@firmivra/db';
import { ListFirmApplicationsQuery, ListFirmsQuery } from '@firmivra/types';
import type { AdminPrisma } from '../../src/firm-applications/admin-prisma.js';
import {
  FirmApplicationsService,
  StoredApplication,
} from '../../src/firm-applications/firm-applications.service.js';

const summary = {
  id: '0199b6a3-0000-7000-8000-000000000042',
  slug: 'sample-harbor-tax',
  name: 'Sample Harbor Tax Services',
  status: 'PENDING_SETUP',
} as const;

/** Synthetic personal details in the columns, and in a `data` that isn't the stored form. */
const row: FirmApplication = {
  id: '0199b6a2-0000-7000-8000-000000000042',
  status: 'APPROVED',
  legalName: 'Sample Harbor Tax Services LLC',
  dbaName: 'Sample Harbor Tax',
  contactName: 'Drew Sample',
  contactEmail: 'drew@sample-harbor.example.test',
  contactPhone: '+14045550142',
  data: {
    businessType: 'Tax and accounting firm',
    primaryAdmin: { fullName: 'Drew Placeholder', email: 'drew.placeholder@sample.example.test' },
    ein: '001234567',
  },
  internalNotes: 'Called the applicant about the PTIN.',
  decisionReason: 'Please send your PTIN.',
  reviewedByUserId: null,
  reviewedAt: new Date('2026-10-02T12:00:00Z'),
  businessId: summary.id,
  einLast4: null,
  einHash: null,
  createdAt: new Date('2026-10-01T12:00:00Z'),
  updatedAt: new Date('2026-10-02T12:00:00Z'),
};
const details = [
  'Sample Harbor',
  'Drew',
  'sample-harbor.example.test',
  '5550142',
  'Tax and accounting firm',
  'Placeholder',
  '001234567',
  'PTIN',
];

const db = {
  firmApplication: {
    count: vi.fn().mockResolvedValue(1),
    findMany: vi.fn().mockResolvedValue([row]),
    findUnique: vi.fn().mockResolvedValue(row),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  firmApplicationStatusHistory: { findMany: vi.fn().mockResolvedValue([]) },
  business: {
    findUnique: vi.fn().mockResolvedValue(summary),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([{ ...summary, createdAt: row.reviewedAt }]),
  },
  membership: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findMany: vi.fn().mockResolvedValue([]) },
};
const service = new FirmApplicationsService(
  { db } as unknown as AdminPrisma,
  { log: vi.fn().mockResolvedValue(undefined) } as never,
);

/** Nothing reaches the console; each test reads what would have been logged. */
const spyOnWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof spyOnWarn>;
beforeEach(() => {
  warn = spyOnWarn();
});
afterEach(() => {
  warn.mockRestore();
});

describe('FirmApplicationsService: a stored form that cannot be read', () => {
  it('is logged with its id only, on every page that reads it', async () => {
    const reads = {
      list: () => service.list(ListFirmApplicationsQuery.parse({})),
      get: () => service.get(row.id),
      listFirms: () => service.listFirms(ListFirmsQuery.parse({})),
      getFirm: () => service.getFirm(summary.id),
    };
    const logged: unknown[][] = [];
    for (const [name, read] of Object.entries(reads)) {
      warn.mockClear();
      await read();
      expect(warn.mock.calls.length, name).toBeGreaterThan(0);
      for (const args of warn.mock.calls) {
        expect(args, name).toEqual([
          `Firm application ${row.id}: the stored form could not be read`,
        ]);
      }
      logged.push(...warn.mock.calls);
    }
    const text = JSON.stringify(logged);
    for (const detail of details) expect(text).not.toContain(detail);
  });

  it('still answers from the columns', async () => {
    const { items } = await service.list(ListFirmApplicationsQuery.parse({}));
    expect(items).toEqual([
      expect.objectContaining({ id: row.id, formReadable: false, contactName: 'Drew Sample' }),
    ]);
    await expect(service.getFirm(summary.id)).resolves.toMatchObject({
      owner: null,
      plan: null,
      application: { id: row.id, formReadable: false, business: null },
    });
  });
});

/** A stored form as submit writes it (synthetic). */
const form = {
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: 'Sample Harbor Tax Services LLC',
    dbaName: null,
    entityType: 'LLC',
    email: null,
    phone: null,
    website: null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: 'Drew Sample',
    email: 'drew@sample-harbor.example.test',
    phone: '+14045550142',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: 3,
    clientVolume: 'FROM_250',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
};

describe("FirmApplicationsService: an older stored form with the EIN's last 4 in it", () => {
  const older = { ...form, business: { ...form.business, einLast4: '7316' } };

  it('reads the form without them', () => {
    const parsed = StoredApplication.parse(older);
    expect(parsed.business).not.toHaveProperty('einLast4');
    expect(parsed).toEqual(form);
  });

  it("never shows them: the record's einLast4 comes from the ein_last4 column only", async () => {
    db.firmApplication.findUnique.mockResolvedValueOnce({ ...row, data: older, einLast4: '4567' });
    const record = await service.get(row.id);
    expect(record.formReadable).toBe(true);
    expect(record.business).toEqual({ ...form.business, einLast4: '4567' });
    expect(JSON.stringify(record)).not.toContain('7316');
    expect(warn).not.toHaveBeenCalled();
  });
});
