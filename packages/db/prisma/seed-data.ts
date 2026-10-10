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

/** Fixed ids of each firm's seeded intake agreement (v1, its PDF row) and the lead's signature. */
export const SEED_AGREEMENT_IDS = {
  lvp: {
    agreement: '00000000-0000-4a11-8000-000000000001',
    file: '00000000-0000-4a11-8000-000000000002',
    version: '00000000-0000-4a11-8000-000000000003',
  },
  testFirmB: {
    agreement: '00000000-0000-4a11-8000-000000000011',
    file: '00000000-0000-4a11-8000-000000000012',
    version: '00000000-0000-4a11-8000-000000000013',
  },
  leadSignature: '00000000-0000-4a11-8000-000000000021',
} as const;

/** The firm-wide intake agreement's synthetic v1. Never a firm's real agreement text. */
export const SAMPLE_AGREEMENT = {
  title: 'Client Intake Agreement (sample)',
  body: [
    '# Client Intake Agreement (sample)',
    '',
    'Sample text for local development. Not legal text.',
    '',
    '## 1. Information you provide',
    '',
    'You confirm that the information in this form is accurate to the best of your knowledge.',
    '',
    '## 2. No engagement yet',
    '',
    'Submitting this form does not start an engagement until the firm confirms it.',
  ].join('\n'),
  acknowledgments: [
    {
      key: 'read_agreement',
      label: 'I have read this agreement',
      text: 'I have read the sample intake agreement. (Sample text, not legal text.)',
      required: true,
    },
    {
      key: 'accurate_information',
      label: 'My information is accurate',
      text: 'The information I provide is accurate to the best of my knowledge. (Sample text.)',
      required: true,
    },
    {
      key: 'electronic_signature',
      label: 'I agree to sign electronically',
      text: 'My typed name is my electronic signature. (Sample text, not legal text.)',
      required: true,
    },
  ],
  /** No PDF exists behind the seeded file row in local S3. */
  pdf: { fileName: 'Client Intake Agreement (sample).pdf', sizeBytes: 48213 },
} as const;

/** One step of a seeded form: one section with the given fields. */
const seedStep = (key: string, title: string, review: boolean, fields: object[]) => ({
  key,
  title,
  review,
  sections: [{ key: `${key}Fields`, title, fields }],
});

/**
 * A seeded v1 form for the kinds whose real form isn't seeded yet: a small definition in the form
 * engine's current shape (IntakeFormDefinition, R11). Annual Tax seeds the real
 * INTAKE_FORMS.ANNUAL_TAX instead. Its keys match the seeded answers (fullName) and the lead
 * upload's slot (priorReturn).
 */
export const seedFormDefinition = (key: string, title: string) => ({
  key,
  version: 1,
  title,
  steps: [
    seedStep('about', 'About you', false, [
      { key: 'fullName', type: 'text', label: 'Full name', required: true, maxLength: 200 },
    ]),
    seedStep('documents', 'Documents', false, [
      {
        key: 'priorReturn',
        type: 'upload',
        label: 'Prior return',
        required: false,
        notAvailable: true,
        maxFiles: 5,
      },
    ]),
    seedStep('review', 'Review and submit', true, [
      {
        key: 'sampleNotice',
        type: 'info',
        label: 'Sample form',
        text: 'For local development.',
        required: false,
      },
    ]),
  ],
});

/** Staff members' own video meeting links (synthetic): Zoom, Google Meet and Teams styles. */
export const SEED_MEETING_URLS = {
  lvpOwner: 'https://zoom.us/j/0000000001',
  lvpStaff: 'https://meet.google.com/aaa-bbbb-ccc',
  firmBOwner: 'https://teams.microsoft.com/l/meetup-join/sample-firm-b-meeting',
} as const;

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

/**
 * LVP's application form as the public form stores it (the API's `StoredApplication`: the review
 * page's groups, every optional field null, never the EIN), so the Super Admin's review page shows
 * it in full instead of "—". The mockup's values ("Firm approved"), with fake contact details.
 */
export const SEED_LVP_APPLICATION_FORM = {
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: 'LVP Accounting & Taxes LLC (fake)',
    dbaName: SEED_BUSINESSES.lvp.name,
    entityType: 'LLC',
    email: SEED_USERS.lvpOwner.email,
    phone: '+14045550100',
    website: null,
    address: {
      line1: '100 Example Street (fake)',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30303',
    },
    services: ['TAX_PREPARATION', 'BOOKKEEPING', 'PAYROLL', 'BUSINESS_CONSULTING'],
  },
  primaryAdmin: {
    fullName: SEED_USERS.lvpOwner.name,
    email: SEED_USERS.lvpOwner.email,
    phone: '+14045550100',
    title: 'Owner',
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: 3,
    clientVolume: 'FROM_500',
    heardFrom: 'Direct request',
    requestedStartDate: null,
    additionalInfo: 'Beta testing for internal use.',
  },
  credentials: [],
} as const;

/** What earlier seeds stored as LVP's form, which the review page can't read: a re-seed replaces it. */
export const SEED_LVP_APPLICATION_OLD_DATA = { businessType: 'Tax and accounting firm' } as const;
