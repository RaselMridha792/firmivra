// Local seed data. Fake people only: never real names, emails or phone numbers.
// User ids double as fake Cognito subs, so local dev tokens stay stable across re-seeds.

export const SEED_BUSINESSES = {
  lvp: { slug: 'lvp', name: 'LVP Accounting & Taxes', status: 'ACTIVE' },
  testFirmB: { slug: 'test-firm-b', name: 'Test Firm B (isolation checks)', status: 'ACTIVE' },
} as const;

export const SEED_USERS = {
  superAdmin: {
    id: '00000000-0000-4000-a000-000000000001',
    pool: 'ADMIN',
    email: 'superadmin@firmivra.test',
    name: 'Sam Admin (fake)',
  },
  lvpOwner: {
    id: '00000000-0000-4000-a000-000000000011',
    pool: 'STAFF',
    email: 'owner@lvp.test',
    name: 'Olivia Owner (fake)',
  },
  lvpStaff: {
    id: '00000000-0000-4000-a000-000000000012',
    pool: 'STAFF',
    email: 'staff@lvp.test',
    name: 'Stan Staff (fake)',
  },
  lvpInvited: {
    id: '00000000-0000-4000-a000-000000000014',
    pool: 'STAFF',
    email: 'invited@lvp.test',
    name: 'Ivy Invited (fake)',
  },
  lvpClient: {
    id: '00000000-0000-4000-a000-000000000013',
    pool: 'CLIENT',
    email: 'client@lvp.test',
    name: 'Chris Client (fake)',
  },
  firmBOwner: {
    id: '00000000-0000-4000-a000-000000000021',
    pool: 'STAFF',
    email: 'owner@firm-b.test',
    name: 'Bea Owner (fake)',
  },
  firmBClient: {
    id: '00000000-0000-4000-a000-000000000022',
    pool: 'CLIENT',
    email: 'client@firm-b.test',
    name: 'Ben Client (fake)',
  },
} as const;

/** Firm-defined tax statuses, in display order. */
export const SEED_TAX_STATUSES = {
  lvp: [
    'Waiting for documents',
    'Documents received',
    'In preparation',
    'Ready for review',
    'Filed',
    'Accepted',
  ],
  testFirmB: ['Received', 'Filed'],
} as const;

/** Fixed id so re-seeding keeps a single open invite for lvpInvited. */
export const SEED_INVITE_ID = '00000000-0000-4000-b000-000000000001';

/** Fixed ids of the firms' client records, linked to the seeded client logins. */
export const SEED_CLIENT_IDS = {
  lvp: '00000000-0000-4000-c000-000000000013',
  testFirmB: '00000000-0000-4000-c000-000000000022',
} as const;

const TAX_STAGES = ['New', 'Missing documents', 'Preparation', 'Review', 'Signature', 'Complete'];

/** Each firm's services, in display order. LVP offers the six Begin Online services. */
export const SEED_SERVICES = {
  lvp: [
    {
      kind: 'ANNUAL_TAX',
      name: 'Annual Tax',
      billingInterval: 'ONE_TIME',
      packages: [],
      stages: TAX_STAGES,
    },
    {
      kind: 'QUARTERLY_TAX',
      name: 'Quarterly Tax',
      billingInterval: 'QUARTERLY',
      packages: [],
      stages: ['Collecting figures', 'Payment sent'],
    },
    {
      kind: 'BOOKKEEPING',
      name: 'Bookkeeping',
      billingInterval: 'MONTHLY',
      packages: ['Starter', 'Growth', 'Premium'],
      stages: ['Onboarding', 'Monthly close', 'Review'],
    },
    {
      kind: 'PAYROLL',
      name: 'Payroll',
      billingInterval: 'MONTHLY',
      packages: [],
      stages: ['Setup', 'Running'],
    },
    {
      kind: 'TAX_PLANNING',
      name: 'Tax Planning',
      billingInterval: 'YEARLY',
      packages: [],
      stages: ['Discovery', 'Projection', 'Plan delivered'],
    },
    {
      kind: 'BUSINESS_DEVELOPMENT',
      name: 'Business Development',
      billingInterval: 'ONE_TIME',
      packages: [],
      stages: [],
    },
  ],
  testFirmB: [
    {
      kind: 'ANNUAL_TAX',
      name: 'Annual Tax',
      billingInterval: 'ONE_TIME',
      packages: [],
      stages: ['New', 'Filed'],
    },
  ],
} as const;

/** Fixed ids of seeded engagements and workspace records, so re-seeding keeps one of each. */
export const SEED_WORK_IDS = {
  lvpTax: '00000000-0000-4000-d000-000000000001',
  lvpBookkeeping: '00000000-0000-4000-d000-000000000002',
  firmBTax: '00000000-0000-4000-d000-000000000003',
  lvpTask: '00000000-0000-4000-d000-000000000011',
  lvpNote: '00000000-0000-4000-d000-000000000021',
  lvpReport: '00000000-0000-4000-d000-000000000031',
} as const;

/** Each firm's document categories, in display order. retentionYears null = kept for good. */
export const SEED_DOCUMENT_CATEGORIES = {
  lvp: [
    { name: 'W-2 and 1099', retentionYears: 7 },
    { name: 'ID', retentionYears: 7 },
    { name: 'Prior-year returns', retentionYears: 7 },
    { name: 'Bank statements', retentionYears: 7 },
    { name: 'Payroll', retentionYears: 4 },
    { name: 'Formation', retentionYears: null },
    { name: 'Final return', retentionYears: 7 },
  ],
  testFirmB: [{ name: 'Tax documents', retentionYears: 7 }],
} as const;

/** Fixed ids of seeded document requests and documents, so re-seeding keeps one of each. */
export const SEED_DOCUMENT_IDS = {
  w2Request: '00000000-0000-4000-e000-000000000001',
  interestRequest: '00000000-0000-4000-e000-000000000002',
  interestDocument: '00000000-0000-4000-e000-000000000011',
} as const;
