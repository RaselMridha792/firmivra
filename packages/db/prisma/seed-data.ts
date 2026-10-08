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
/** Fixed id of the activation link Firmivra sent LVP's owner on approval (accepted). */
export const SEED_OWNER_INVITE_ID = '00000000-0000-4000-b000-000000000002';

/** Fixed ids of the firms' client records, linked to the seeded client logins. */
export const SEED_CLIENT_IDS = {
  lvp: '00000000-0000-400c-8000-000000000013',
  testFirmB: '00000000-0000-400c-8000-000000000022',
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
  lvpTax: '00000000-0000-400d-8000-000000000001',
  lvpBookkeeping: '00000000-0000-400d-8000-000000000002',
  firmBTax: '00000000-0000-400d-8000-000000000003',
  lvpTax2024: '00000000-0000-400d-8000-000000000004',
  lvpTask: '00000000-0000-400d-8000-000000000011',
  lvpNote: '00000000-0000-400d-8000-000000000021',
  lvpReport: '00000000-0000-400d-8000-000000000031',
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
  w2Request: '00000000-0000-400e-8000-000000000001',
  interestRequest: '00000000-0000-400e-8000-000000000002',
  interestDocument: '00000000-0000-400e-8000-000000000011',
  return2024: '00000000-0000-400e-8000-000000000021',
} as const;

/** Fixed ids of the LVP client's seeded tax returns (portal Taxes tab). */
export const SEED_TAX_RETURN_IDS = {
  lvp2023: '00000000-0000-4000-9100-000000000001',
  lvp2024: '00000000-0000-4000-9100-000000000002',
  lvp2025: '00000000-0000-4000-9100-000000000003',
} as const;

/** Fixed ids of seeded intakes and the Begin Online lead, so re-seeding keeps one of each. */
export const SEED_INTAKE_IDS = {
  taxIntake: '00000000-0000-400f-8000-000000000001',
  taxSubmission: '00000000-0000-400f-8000-000000000002',
  lead: '00000000-0000-400f-8000-000000000011',
  leadIntake: '00000000-0000-400f-8000-000000000012',
  leadSubmission: '00000000-0000-400f-8000-000000000013',
  leadUpload: '00000000-0000-400f-8000-000000000014',
} as const;

/** A small placeholder form definition until the form engine (I06) sets the real shape. */
export const SAMPLE_FORM_DEFINITION = {
  steps: [
    {
      id: 'about',
      title: 'About you',
      fields: [{ id: 'fullName', type: 'text', label: 'Full name', required: true }],
    },
    {
      id: 'documents',
      title: 'Documents',
      fields: [
        { id: 'priorReturn', type: 'upload', label: 'Last year return', notAvailable: true },
      ],
    },
    { id: 'sign', title: 'Review and sign', fields: [] },
  ],
};

/** Fixed ids of seeded notifications and their deliveries, so re-seeding keeps one of each. */
export const SEED_NOTIFICATION_IDS = {
  clientW2: '00000000-0000-4000-9000-000000000001',
  clientW2Email: '00000000-0000-4000-9000-000000000002',
  clientW2Sms: '00000000-0000-4000-9000-000000000003',
  staffLead: '00000000-0000-4000-9000-000000000011',
  staffLeadEmail: '00000000-0000-4000-9000-000000000012',
} as const;

/** Each firm's appointment types, in display order. */
export const SEED_APPOINTMENT_TYPES = {
  lvp: [
    { name: 'Tax consultation', durationMinutes: 30, locationKind: 'VIDEO', clientBookable: true },
    {
      name: 'Document drop-off',
      durationMinutes: 15,
      locationKind: 'IN_PERSON',
      clientBookable: true,
    },
    {
      name: 'Bookkeeping review',
      durationMinutes: 60,
      locationKind: 'VIDEO',
      clientBookable: false,
    },
  ],
  testFirmB: [
    { name: 'Consultation', durationMinutes: 30, locationKind: 'PHONE', clientBookable: true },
  ],
} as const;

/** Fixed ids of the seeded appointment and firm closure, so re-seeding keeps one of each. */
export const SEED_CALENDAR_IDS = {
  appointment: '00000000-0000-4000-8000-000000000001',
  thanksgiving: '00000000-0000-4000-8000-000000000002',
} as const;

/** Fixed ids of seeded message threads, messages and the client's note, for re-seeding. */
export const SEED_MESSAGE_IDS = {
  w2Thread: '00000000-0000-4007-8000-000000000001',
  w2Question: '00000000-0000-4007-8000-000000000002',
  w2Answer: '00000000-0000-4007-8000-000000000003',
  welcomeThread: '00000000-0000-4007-8000-000000000011',
  welcomeMessage: '00000000-0000-4007-8000-000000000012',
  clientNote: '00000000-0000-4007-8000-000000000021',
  clientNoteReminder: '00000000-0000-4007-8000-000000000022',
} as const;

/** Fixed ids of seeded billing and content records, so re-seeding keeps one of each. */
export const SEED_BILLING_IDS = {
  paidInvoice: '00000000-0000-4006-8000-000000000001',
  paidPayment: '00000000-0000-4006-8000-000000000002',
  openInvoice: '00000000-0000-4006-8000-000000000011',
  refundLink: '00000000-0000-4006-8000-000000000021',
  transcriptLink: '00000000-0000-4006-8000-000000000022',
  recordKeeping: '00000000-0000-4006-8000-000000000023',
  receiptsTip: '00000000-0000-4006-8000-000000000024',
  /** INV-1002, part paid by check (an offline payment). */
  offlineInvoice: '00000000-0000-4006-8000-000000000031',
  offlinePayment: '00000000-0000-4006-8000-000000000032',
  offlinePaymentKey: '00000000-0000-4006-8000-000000000033',
} as const;

/** LVP's Stripe connected account for local development: fake, never a real account id. */
export const SEED_STRIPE_ACCOUNT_ID = 'acct_1LvpLocalSeed0001';

/** Fixed ids of LVP's firm application, a support request and sample audit events. */
export const SEED_PLATFORM_IDS = {
  lvpApplication: '00000000-0000-4005-8000-000000000001',
  supportRequest: '00000000-0000-4005-8000-000000000002',
  platformEvent: '00000000-0000-4005-8000-000000000011',
  firmEvent: '00000000-0000-4005-8000-000000000012',
} as const;
