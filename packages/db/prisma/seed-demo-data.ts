// Demo data constants (R0, PART 2): the `demo` business and its synthetic people. Separate from
// seed-data.ts (LVP and Test Firm B) so the two never conflict. Fake people only, a `.test` email
// domain, no real names or numbers (hard rule 9). `demoId(key)` makes every id in this stage
// deterministic from a short, readable key, so re-running `pnpm db:seed:demo` upserts the same
// rows instead of duplicating them, and `pnpm db:unseed:demo` can find exactly what it made.
import { createHash } from 'node:crypto';

/**
 * A stable, RFC-4122-shaped v4 id from a short key (`demoId('client:07')`), so the demo seed
 * never hand-manages hundreds of literal UUIDs. Deterministic: the same key always makes the same
 * id, on this run and the next. Not a security token -- never used for anything but demo seed
 * identity.
 */
export function demoId(key: string): string {
  const hash = createHash('sha256').update(`firmivra-demo:${key}`).digest('hex');
  const bytes = hash.slice(0, 32).split('');
  bytes[12] = '4'; // version 4
  bytes[16] = ((parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const hex = bytes.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export const SEED_DEMO_BUSINESS = {
  slug: 'demo',
  name: 'Demo Accounting Group',
} as const;

export const SEED_DEMO_USERS = {
  owner: {
    id: demoId('user:owner'),
    pool: 'STAFF',
    email: 'owner@demo.test',
    name: 'Jordan Blake',
  },
  // Six staff across three departments: every firm role used at least once (R35's eight roles,
  // minus OWNER, which the owner above already covers).
  admin: {
    id: demoId('user:admin'),
    pool: 'STAFF',
    email: 'admin@demo.test',
    name: 'Casey Nguyen',
  },
  manager: {
    id: demoId('user:manager'),
    pool: 'STAFF',
    email: 'manager@demo.test',
    name: 'Riley Thompson',
  },
  bookkeeper: {
    id: demoId('user:bookkeeper'),
    pool: 'STAFF',
    email: 'bookkeeper@demo.test',
    name: 'Avery Martinez',
  },
  taxPreparer: {
    id: demoId('user:tax-preparer'),
    pool: 'STAFF',
    email: 'tax-preparer@demo.test',
    name: 'Morgan Lee',
  },
  clientSupport: {
    id: demoId('user:client-support'),
    pool: 'STAFF',
    email: 'client-support@demo.test',
    name: 'Jamie Patel',
  },
  readOnly: {
    id: demoId('user:read-only'),
    pool: 'STAFF',
    email: 'read-only@demo.test',
    name: 'Taylor Brooks',
  },
} as const;

export type DemoStaffKey = keyof typeof SEED_DEMO_USERS;

/** One synthetic staff login the whole demo build keeps referring to, keyed by name. */
export const SEED_DEMO_STAFF: readonly {
  key: Exclude<DemoStaffKey, 'owner'>;
  role: 'ADMIN' | 'MANAGER' | 'BOOKKEEPER' | 'TAX_PREPARER' | 'CLIENT_SUPPORT' | 'READ_ONLY';
  department: 'TAX_ACCOUNTING' | 'CLIENT_SERVICES' | 'OPERATIONS';
  title: string;
}[] = [
  { key: 'admin', role: 'ADMIN', department: 'OPERATIONS', title: 'Operations Admin' },
  { key: 'manager', role: 'MANAGER', department: 'TAX_ACCOUNTING', title: 'Engagement Manager' },
  {
    key: 'bookkeeper',
    role: 'BOOKKEEPER',
    department: 'TAX_ACCOUNTING',
    title: 'Senior Bookkeeper',
  },
  {
    key: 'taxPreparer',
    role: 'TAX_PREPARER',
    department: 'TAX_ACCOUNTING',
    title: 'Tax Preparer',
  },
  {
    key: 'clientSupport',
    role: 'CLIENT_SUPPORT',
    department: 'CLIENT_SERVICES',
    title: 'Client Support Specialist',
  },
  {
    key: 'readOnly',
    role: 'READ_ONLY',
    department: 'OPERATIONS',
    title: 'Compliance Analyst',
  },
];

export const SEED_DEMO_DEPARTMENTS = [
  {
    code: 'TAX_ACCOUNTING',
    id: demoId('department:tax-accounting'),
    name: 'Tax & Accounting',
    description: 'Tax preparation, planning and bookkeeping delivery.',
  },
  {
    code: 'CLIENT_SERVICES',
    id: demoId('department:client-services'),
    name: 'Client Services',
    description: 'Onboarding, support and the client portal experience.',
  },
  {
    code: 'OPERATIONS',
    id: demoId('department:operations'),
    name: 'Operations',
    description: 'Firm operations, compliance and administration.',
  },
] as const;

/**
 * Each team's own roster, by SEED_DEMO_STAFF key. A member is on at most one team here (the
 * database allows only one PRIMARY, and one BACKUP, team per member); `lead` is also the first
 * (PRIMARY) member.
 */
export const SEED_DEMO_TEAMS: readonly {
  code: string;
  department: (typeof SEED_DEMO_DEPARTMENTS)[number]['code'];
  name: string;
  lead: Exclude<DemoStaffKey, 'owner'>;
  members: readonly Exclude<DemoStaffKey, 'owner'>[];
}[] = [
  {
    code: 'INDIVIDUAL_TAX',
    department: 'TAX_ACCOUNTING',
    name: 'Individual Tax',
    lead: 'manager',
    members: ['manager', 'taxPreparer'],
  },
  {
    code: 'BOOKKEEPING',
    department: 'TAX_ACCOUNTING',
    name: 'Bookkeeping',
    lead: 'bookkeeper',
    members: ['bookkeeper'],
  },
  {
    code: 'ONBOARDING',
    department: 'CLIENT_SERVICES',
    name: 'Onboarding & Support',
    lead: 'clientSupport',
    members: ['clientSupport'],
  },
];

/**
 * 25 synthetic demo clients: tidy plausible names, a mix of individual and business, spread
 * across every status and assigned staff member so the directory, filters and charts have real
 * variety. `portal`: exactly one gets a working client portal login (the coverage rule).
 */
export const SEED_DEMO_CLIENTS: readonly {
  key: string;
  name: string;
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  email: string;
  assigned: DemoStaffKey;
  portal?: true;
}[] = [
  {
    key: '01',
    name: 'Harper Coleman',
    accountType: 'INDIVIDUAL',
    email: 'harper.coleman@demo.test',
    assigned: 'manager',
    portal: true,
  },
  {
    key: '02',
    name: 'Sawyer Reed',
    accountType: 'INDIVIDUAL',
    email: 'sawyer.reed@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '03',
    name: 'Parker Alvarez',
    accountType: 'INDIVIDUAL',
    email: 'parker.alvarez@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '04',
    name: 'Blue Ridge Landscaping LLC',
    accountType: 'BUSINESS',
    email: 'accounts@blueridgelandscaping.demo.test',
    assigned: 'bookkeeper',
  },
  {
    key: '05',
    name: 'Dakota Foster',
    accountType: 'INDIVIDUAL',
    email: 'dakota.foster@demo.test',
    assigned: 'manager',
  },
  {
    key: '06',
    name: 'Rowan Mitchell',
    accountType: 'INDIVIDUAL',
    email: 'rowan.mitchell@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '07',
    name: 'Harborview Dental PLLC',
    accountType: 'BUSINESS',
    email: 'office@harborviewdental.demo.test',
    assigned: 'bookkeeper',
  },
  {
    key: '08',
    name: 'Emerson Vargas',
    accountType: 'INDIVIDUAL',
    email: 'emerson.vargas@demo.test',
    assigned: 'clientSupport',
  },
  {
    key: '09',
    name: 'Quinn Delgado',
    accountType: 'INDIVIDUAL',
    email: 'quinn.delgado@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '10',
    name: 'Cedar & Stone Bakery',
    accountType: 'BUSINESS',
    email: 'finance@cedarstonebakery.demo.test',
    assigned: 'bookkeeper',
  },
  {
    key: '11',
    name: 'Finley Ramos',
    accountType: 'INDIVIDUAL',
    email: 'finley.ramos@demo.test',
    assigned: 'manager',
  },
  {
    key: '12',
    name: 'Skyler Brennan',
    accountType: 'INDIVIDUAL',
    email: 'skyler.brennan@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '13',
    name: 'Northgate Consulting Group',
    accountType: 'BUSINESS',
    email: 'billing@northgateconsulting.demo.test',
    assigned: 'manager',
  },
  {
    key: '14',
    name: 'Alexis Winslow',
    accountType: 'INDIVIDUAL',
    email: 'alexis.winslow@demo.test',
    assigned: 'clientSupport',
  },
  {
    key: '15',
    name: 'Jordan Pierce',
    accountType: 'INDIVIDUAL',
    email: 'jordan.pierce@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '16',
    name: 'Riverside Auto Repair Inc',
    accountType: 'BUSINESS',
    email: 'books@riversideautorepair.demo.test',
    assigned: 'bookkeeper',
  },
  {
    key: '17',
    name: 'Cameron Osei',
    accountType: 'INDIVIDUAL',
    email: 'cameron.osei@demo.test',
    assigned: 'manager',
  },
  {
    key: '18',
    name: 'Peyton Salazar',
    accountType: 'INDIVIDUAL',
    email: 'peyton.salazar@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '19',
    name: 'Golden Leaf Wellness Studio',
    accountType: 'BUSINESS',
    email: 'admin@goldenleafwellness.demo.test',
    assigned: 'clientSupport',
  },
  {
    key: '20',
    name: 'Marlowe Chandra',
    accountType: 'INDIVIDUAL',
    email: 'marlowe.chandra@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '21',
    name: 'August Kowalski',
    accountType: 'INDIVIDUAL',
    email: 'august.kowalski@demo.test',
    assigned: 'manager',
  },
  {
    key: '22',
    name: 'Union Street Hardware LLC',
    accountType: 'BUSINESS',
    email: 'office@unionstreethardware.demo.test',
    assigned: 'bookkeeper',
  },
  {
    key: '23',
    name: 'Hayden Okafor',
    accountType: 'INDIVIDUAL',
    email: 'hayden.okafor@demo.test',
    assigned: 'clientSupport',
  },
  {
    key: '24',
    name: 'Remy Castellano',
    accountType: 'INDIVIDUAL',
    email: 'remy.castellano@demo.test',
    assigned: 'taxPreparer',
  },
  {
    key: '25',
    name: 'Brightwater Property Management',
    accountType: 'BUSINESS',
    email: 'accounting@brightwaterpm.demo.test',
    assigned: 'manager',
  },
];

/** The one demo client with a working portal login (coverage rule). */
export const SEED_DEMO_PORTAL_CLIENT = SEED_DEMO_CLIENTS.find((c) => c.portal)!;

/**
 * People who signed up on the demo firm's portal and are waiting for the firm (Sign-ups page):
 * a CLIENT login each, with a verified email. One was declined. Unseed removes these logins too.
 */
export const SEED_DEMO_SIGNUPS: readonly {
  key: string;
  name: string;
  email: string;
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  declined?: string;
}[] = [
  { key: 'su1', name: 'Rachel Kim', email: 'rachel.kim@demo.test', accountType: 'INDIVIDUAL' },
  { key: 'su2', name: 'Tomas Rivera', email: 'tomas.rivera@demo.test', accountType: 'INDIVIDUAL' },
  { key: 'su3', name: 'Jasmine Ford', email: 'jasmine.ford@demo.test', accountType: 'BUSINESS' },
  {
    key: 'su4',
    name: 'Victor Hale',
    email: 'victor.hale@demo.test',
    accountType: 'INDIVIDUAL',
    declined: 'We could not match this sign-up to a client of the firm.',
  },
];

export const demoSignupUserId = (key: string): string => demoId(`user:signup:${key}`);
