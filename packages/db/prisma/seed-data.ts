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
