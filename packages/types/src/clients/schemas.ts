import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import {
  ClientAccountType,
  ClientPortalRole,
  ClientPriority,
  ClientStatus,
  ContactMethod,
  EngagementStatus,
  LeadSource,
  ServiceKind,
} from '../db-enums.js';
import { US_STATES } from '../intake/options.js';
import { ClientAccountStatus } from '../schemas.js';
import { clearable, SearchText, text } from './text.js';

// Database enums, also exported from here as before db-enums.ts (other modules import them).
export { ClientAccountType, ClientPortalRole, ContactMethod };

// Client records (R10): the firm's clients list and record, the client's profile and their tax
// status per year, plus the client's own My Profile in the portal.
// Firm routes: /api/v1/business/clients/... Owner and Admin see every client of the firm; Staff
// see and edit only the clients assigned to them (any other is 404). Only Owner and Admin change
// the assignee, filter by assignee, archive and restore (403 for Staff).
// Portal routes: /api/v1/portal/{firmSlug}/me/... (the signed-in client's own record only).
// SSN and EIN: only the last 4 digits ever leave the API. Date of birth: in full to the firm's
// staff and to the client's primary login, never in lists.
// Responses are plain objects (a field the API adds later is dropped, so an open page keeps
// working); requests are strict (unknown fields such as businessId are refused).

const DateTime = z.iso.datetime({ offset: true });
/** A calendar date, YYYY-MM-DD. */
export const CalendarDate = z.iso.date();
/** A past (or today's) calendar date, e.g. a date of birth. */
const PastDate = CalendarDate.refine(
  (d) => d <= new Date().toISOString().slice(0, 10),
  'The date cannot be in the future',
).refine((d) => d >= '1900-01-01', 'Enter a date from 1900 on');

/** A client id in a path: anything else gets 400 VALIDATION_FAILED. */
export const ClientId = z.uuid();
/** A tax year, 2000-2100: a number, or exactly four digits in a path (not 02026, 2026.0 or 0x7EA). */
export const TaxYear = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{4}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(2000).max(2100));

// INDIVIDUAL or BUSINESS, EMAIL / PHONE / TEXT, PRIMARY / SPOUSE / AUTHORIZED: the database
// enums, generated into db-enums.ts (exported from the package there).

/** A firm member shown next to a record (assigned to, changed by). */
export const MemberRef = z.object({ userId: z.uuid(), name: z.string() });
export type MemberRef = z.infer<typeof MemberRef>;

export const Address = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  /** Two-letter state code for US addresses. */
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
});
export type Address = z.infer<typeof Address>;

const last4 = z
  .string()
  .regex(/^\d{4}$/)
  .nullable();

// ---------- The firm's clients ----------
/** One row of the clients list (no profile, SSN, EIN or date of birth). */
export const ClientListItem = z.object({
  id: z.uuid(),
  accountType: ClientAccountType,
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  assignedTo: MemberRef.nullable(),
  /** The primary portal login's status; null when the client has no login. */
  portalStatus: ClientAccountStatus.nullable(),
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type ClientListItem = z.infer<typeof ClientListItem>;

/** A service the client has open work in (an engagement that is PENDING or ACTIVE). */
export const ClientServiceRef = z.object({ id: z.uuid(), name: z.string(), kind: ServiceKind });
export type ClientServiceRef = z.infer<typeof ClientServiceRef>;

/**
 * One row of the clients list (clients.jpg, R1): the record's list fields plus the work around it.
 * Only values the data holds: a client with no open request has 0 missing documents, no invoice
 * a 0 balance, no visit `lastActivityAt` null.
 */
export const ClientListRow = ClientListItem.extend({
  /** The firm's own stage for the client (NEW, PENDING_DOCUMENTS, IN_PROGRESS, ACTIVE, ON_HOLD, INACTIVE). */
  status: ClientStatus,
  /** Services with open engagements, by name. */
  services: z.array(ClientServiceRef).max(50),
  /** Document requests the client still owes (REQUESTED, or REJECTED and asked again). */
  missingDocuments: z.number().int().nonnegative(),
  /** What the client owes on OPEN invoices, in cents. */
  balanceDueCents: z.number().int().nonnegative(),
  /**
   * Octavia's E2: the client's latest event: a message in its thread, a document uploaded or
   * requested, a task completed, an appointment held, an invoice sent or paid, an e-sign
   * completed or a note added. Worked out when the list is read; `lastActivityFrom`/`To` filter
   * on it.
   */
  lastActivityAt: DateTime.nullable(),
  /** The next SCHEDULED appointment; null when none is booked. */
  nextAppointmentAt: DateTime.nullable(),
});
export type ClientListRow = z.infer<typeof ClientListRow>;

/**
 * GET /business/clients. Search matches the name, email and phone. Newest first. Staff get only
 * their own clients; `assignedUserId` is for Owner and Admin (403 for Staff). Paging: `cursor`
 * (from nextCursor), or `page` for numbered pages (not both); `total` counts every match.
 */
export const ListClientsQuery = z
  .strictObject({
    search: SearchText.optional(),
    status: z.enum(['active', 'archived', 'all']).optional().default('active'),
    assignedUserId: z.uuid().optional(),
    /** The firm's stage (the list's tabs: Active, New, ...). */
    clientStatus: ClientStatus.optional(),
    /** Clients with an open engagement in this service (the service tabs). */
    serviceId: z.uuid().optional(),
    /**
     * With serviceId (D4, a dashboard service card): clients with an engagement of that service in
     * this status, instead of an open one.
     */
    engagementStatus: EngagementStatus.optional(),
    /**
     * With serviceId: clients with an engagement of that service completed on these days (the
     * firm's calendar), as a dashboard card's Completed in the period counts them.
     */
    completedFrom: CalendarDate.optional(),
    completedTo: CalendarDate.optional(),
    /** Last activity on or after / on or before these days (the firm's calendar days). */
    lastActivityFrom: CalendarDate.optional(),
    lastActivityTo: CalendarDate.optional(),
    /**
     * Clients who still owe something, as the Pending Documents and Balances Due cards count them
     * (Octavia's E1): DOCUMENTS, at least one document request REQUESTED or REJECTED; BALANCE, an
     * unpaid balance on an OPEN invoice, overdue or not.
     */
    owes: z.enum(['DOCUMENTS', 'BALANCE']).optional(),
    // ---- Octavia's approved additions (Oct 25 review, E2 additions): Added Last 30 Days and
    // More Filters. Each narrows the list; days are the firm's calendar days, both ends included.
    /** Added on or after this day (Added Last 30 Days: the creation date, not the New stage). */
    addedFrom: CalendarDate.optional(),
    /** An open compliance deadline (not completed, cancelled or not applicable) due on these days. */
    deadlineFrom: CalendarDate.optional(),
    deadlineTo: CalendarDate.optional(),
    /** A scheduled appointment on these days. */
    appointmentFrom: CalendarDate.optional(),
    appointmentTo: CalendarDate.optional(),
    /** The primary client type, separate from the business's entity type. */
    accountType: ClientAccountType.optional(),
    /** The profile's state (two letters) and its city or county (part of either). */
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter state code')
      .optional(),
    place: SearchText.optional(),
    /** DUE: an unpaid balance on an OPEN invoice; NONE: nothing owed. */
    balance: z.enum(['DUE', 'NONE']).optional(),
    /** MISSING: a document request still owed (REQUESTED or REJECTED); NONE: nothing owed. */
    documents: z.enum(['MISSING', 'NONE']).optional(),
    /** One of the firm's tags (Settings > Tags). */
    tagId: z.uuid().optional(),
    /** Where the client came from (the lead sources). */
    source: LeadSource.optional(),
    priority: ClientPriority.optional(),
    /** From the previous page's nextCursor. */
    cursor: z.string().max(200).optional(),
    /** A numbered page, 1 first. */
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  })
  .refine((q) => !(q.cursor && q.page), { message: 'Use cursor or page, not both', path: ['page'] })
  .refine(
    (q) => !q.lastActivityFrom || !q.lastActivityTo || q.lastActivityFrom <= q.lastActivityTo,
    { message: 'The start is after the end', path: ['lastActivityTo'] },
  )
  .refine((q) => q.serviceId || (!q.engagementStatus && !q.completedFrom && !q.completedTo), {
    message: 'Choose the service first',
    path: ['serviceId'],
  })
  .refine((q) => !q.completedFrom || !q.completedTo || q.completedFrom <= q.completedTo, {
    message: 'The start is after the end',
    path: ['completedTo'],
  })
  .refine((q) => !q.deadlineFrom || !q.deadlineTo || q.deadlineFrom <= q.deadlineTo, {
    message: 'The start is after the end',
    path: ['deadlineTo'],
  })
  .refine((q) => !q.appointmentFrom || !q.appointmentTo || q.appointmentFrom <= q.appointmentTo, {
    message: 'The start is after the end',
    path: ['appointmentTo'],
  });
export type ListClientsQuery = z.input<typeof ListClientsQuery>;

/**
 * POST /business/clients/export (Octavia's E2 additions): the clients the list's filters show, as
 * a CSV, for the Owner and anyone whose grid grants Clients EXPORT (403 otherwise, checked on the
 * server). The same filters as the list, without paging; at most 5,000 rows. Minimal fields: the
 * name, type, email, phone, stage, services, assignee, missing documents, balance, last activity,
 * next appointment and the day added; never an SSN, EIN or date of birth. Audited with the count.
 */
export const ExportClientsRequest = z.strictObject({
  search: SearchText.optional(),
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  assignedUserId: z.uuid().optional(),
  clientStatus: ClientStatus.optional(),
  serviceId: z.uuid().optional(),
  /** With serviceId: a dashboard service card's clients, as the list (D4). */
  engagementStatus: EngagementStatus.optional(),
  completedFrom: CalendarDate.optional(),
  completedTo: CalendarDate.optional(),
  lastActivityFrom: CalendarDate.optional(),
  lastActivityTo: CalendarDate.optional(),
  owes: z.enum(['DOCUMENTS', 'BALANCE']).optional(),
  addedFrom: CalendarDate.optional(),
  deadlineFrom: CalendarDate.optional(),
  deadlineTo: CalendarDate.optional(),
  appointmentFrom: CalendarDate.optional(),
  appointmentTo: CalendarDate.optional(),
  accountType: ClientAccountType.optional(),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter state code')
    .optional(),
  place: SearchText.optional(),
  balance: z.enum(['DUE', 'NONE']).optional(),
  documents: z.enum(['MISSING', 'NONE']).optional(),
  tagId: z.uuid().optional(),
  source: LeadSource.optional(),
  priority: ClientPriority.optional(),
});
export type ExportClientsRequest = z.input<typeof ExportClientsRequest>;

/** A short-lived link to the CSV (five minutes), and how many clients it holds. */
export const ClientExportLink = z.object({
  url: z.string(),
  expiresAt: DateTime,
  fileName: z.string(),
  rowCount: z.number().int(),
});
export type ClientExportLink = z.infer<typeof ClientExportLink>;

export const ListClientsResponse = z.object({
  items: z.array(ClientListRow).max(100),
  /** Null on the last page (and with `page`). */
  nextCursor: z.string().nullable(),
  /** Every client that matches the filters. */
  total: z.number().int().nonnegative(),
});
export type ListClientsResponse = z.infer<typeof ListClientsResponse>;

/** A KPI card: the number now, and the same number for the period before (null: no history keeps it). */
export const ClientsKpi = z.object({
  value: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative().nullable(),
});
export type ClientsKpi = z.infer<typeof ClientsKpi>;

/**
 * GET /business/clients/summary (clients.jpg's cards and tabs). Staff count only their own
 * clients, as the list shows them. Months are the firm's (business settings time zone).
 */
export const ClientsSummary = z.object({
  kpis: z.object({
    /** Clients not archived; previous: at the start of this month. */
    totalClients: ClientsKpi,
    /** Clients added this month; previous: last month. */
    newClients: ClientsKpi,
    /**
     * Not archived, stage ACTIVE (the Active tab lists the same clients with clientStatus=ACTIVE);
     * previous is null (stage changes keep no history).
     */
    activeClients: ClientsKpi,
    /** Not archived, with at least one missing document; previous is null. */
    pendingDocuments: ClientsKpi,
    /** Not archived, owing on an OPEN invoice; previous is null. */
    balancesDue: ClientsKpi,
    /**
     * Not archived, stage INACTIVE (the Inactive tab; archiving is separate and hides the client);
     * previous is null.
     */
    inactiveClients: ClientsKpi,
  }),
  /** The tabs' counts. */
  counts: z.object({
    all: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    /** Not archived clients with an open engagement in each service the firm offers, by name. */
    byService: z.array(ClientServiceRef.extend({ count: z.number().int().nonnegative() })).max(100),
  }),
});
export type ClientsSummary = z.infer<typeof ClientsSummary>;

/**
 * POST /business/clients/bulk (the list's Bulk Actions), Owner and Admin: the same change to up
 * to 100 clients. ASSIGN sets (or with null clears) the assignee; ARCHIVE and RESTORE as for one
 * client. An id that is not one of the firm's clients, or an assignee who is not an active
 * member, refuses the whole request (404 NOT_FOUND) before anything changes. Then each client is
 * changed and audited on its own; one whose state refuses it (CLIENT_ARCHIVED for ASSIGN) is
 * skipped with its code and the rest still change.
 */
export const BulkClientsRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ASSIGN'),
    clientIds: z.array(z.uuid()).min(1).max(100),
    assignedUserId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal('ARCHIVE'),
    clientIds: z.array(z.uuid()).min(1).max(100),
  }),
  z.strictObject({
    action: z.literal('RESTORE'),
    clientIds: z.array(z.uuid()).min(1).max(100),
  }),
]);
export type BulkClientsRequest = z.infer<typeof BulkClientsRequest>;

export const BulkClientsResponse = z.object({
  updated: z.number().int().nonnegative(),
  skipped: z.array(z.object({ clientId: z.uuid(), code: z.string() })).max(100),
});
export type BulkClientsResponse = z.infer<typeof BulkClientsResponse>;

/** The profile as the firm sees it. */
export const ClientProfile = z.object({
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  /** BUSINESS clients: legal name and entity type (LLC, S corp...). */
  businessName: z.string().nullable(),
  entityType: z.string().nullable(),
  dateOfBirth: CalendarDate.nullable(),
  /**
   * True when a date of birth is on file but can't be read right now (no firm key, KMS down, a
   * damaged value): `dateOfBirth` is then null, and the screen asks for it to be entered again.
   */
  dateOfBirthUnavailable: z.boolean(),
  /** The only part of the SSN the API ever returns. */
  ssnLast4: last4,
  /** BUSINESS clients: the only part of the EIN the API ever returns. */
  einLast4: last4,
  address: Address,
  preferredContactMethod: ContactMethod.nullable(),
  referralSource: z.string().nullable(),
  additionalInfo: z.string().nullable(),
  /**
   * Octavia's E5: a BUSINESS client's responsible party, the person linked to the business (not
   * replacing it): full name, email and E.164 phone, all three or none.
   */
  responsibleParty: z.object({ name: z.string(), email: z.string(), phone: z.string() }).nullable(),
  updatedAt: DateTime.nullable(),
});
export type ClientProfile = z.infer<typeof ClientProfile>;

/** GET /business/clients/{id}: the record page (header, overview, contact, profile). */
export const ClientRecord = ClientListItem.extend({
  profile: ClientProfile,
  portalLogins: z.array(
    z.object({
      clientAccountId: z.uuid(),
      email: z.string(),
      portalRole: ClientPortalRole,
      status: ClientAccountStatus,
    }),
  ),
  updatedAt: DateTime,
});
export type ClientRecord = z.infer<typeof ClientRecord>;

const AddressInput = z.strictObject({
  line1: clearable(text(200)),
  line2: clearable(text(200)),
  city: clearable(text(100)),
  state: clearable(text(50)),
  postalCode: clearable(z.string().regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid ZIP code')),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code')
    .optional(),
});

const digits = (count: number, message: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(new RegExp(`^\\d{${count}}$`), message));

/** The profile fields a request may send (see UpdateClientProfileRequest). */
const ProfileFields = z.strictObject({
  firstName: clearable(text(100)),
  middleName: clearable(text(100)),
  lastName: clearable(text(100)),
  preferredName: clearable(text(100)),
  businessName: clearable(text(200)),
  entityType: clearable(text(50)),
  dateOfBirth: clearable(PastDate),
  ssn: clearable(digits(9, 'Enter the 9-digit SSN')),
  ein: clearable(digits(9, 'Enter the 9-digit EIN')),
  address: AddressInput.optional(),
  preferredContactMethod: clearable(ContactMethod),
  referralSource: clearable(text(200)),
  additionalInfo: clearable(text(2000, 'many')),
  /** E5: a Business client's responsible party, all three together; `null` clears it. */
  responsibleParty: z
    .strictObject({
      name: text(200, 'one', 'Enter their full name'),
      email: Email,
      phone: Phone,
    })
    .nullable()
    .optional(),
});

/**
 * PUT /business/clients/{id}/profile (firm). Send only the fields to change; `null` or `''`
 * clears one. `ssn`, `ein` (9 digits, dashes allowed) and `dateOfBirth` are stored encrypted and
 * come back only as ssnLast4, einLast4 and dateOfBirth.
 */
export const UpdateClientProfileRequest = ProfileFields.refine(
  (body) => Object.values(body).some((v) => v !== undefined),
  'Change at least one field',
);
export type UpdateClientProfileRequest = z.input<typeof UpdateClientProfileRequest>;

/**
 * POST /business/clients: a client with no portal login yet. `assignedUserId` is for Owner and
 * Admin; a client Staff create is assigned to them.
 */
export const CreateClientRequest = z.strictObject({
  accountType: ClientAccountType.optional().default('INDIVIDUAL'),
  displayName: text(200, 'one', 'Enter a name'),
  email: clearable(Email),
  phone: clearable(Phone),
  assignedUserId: z.uuid().optional(),
  /** The same fields as the profile update; `{}` is the same as leaving it out. */
  profile: ProfileFields.optional(),
});
export type CreateClientRequest = z.input<typeof CreateClientRequest>;

/** What a firm form holds for a client, whichever form it is (Add New Client, Edit Details). */
export interface ClientFormFields {
  accountType?: 'INDIVIDUAL' | 'BUSINESS';
  email?: string | null;
  phone?: string | null;
  profile?: {
    businessName?: string | null;
    address?: {
      line1?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string;
    } | null;
    responsibleParty?: { name?: string; email?: string; phone?: string } | null;
  } | null;
}

/**
 * What the firm's client forms require (Octavia's D1 and E5, review of Oct 25), with the path of
 * each missing field in the create request's shape: the email, phone and address for both types
 * (a home address for an Individual, the business's for a Business; a US address takes a state
 * code and a 5-digit ZIP), and for a Business its Business Name and its responsible party (full
 * name, email and phone). The API takes the looser requests, which the calendar's quick add uses
 * with a name and a contact only; it refuses clearing a Business's responsible party.
 */
export function clientFormIssues(body: ClientFormFields): { path: string[]; message: string }[] {
  const out: { path: string[]; message: string }[] = [];
  const need = (path: string[], value: unknown, message: string) => {
    if (typeof value !== 'string' || !value.trim()) out.push({ path, message });
  };
  need(['email'], body.email, 'Enter an email address');
  need(['phone'], body.phone, 'Enter a phone number');
  const address = body.profile?.address;
  const at = (key: string) => ['profile', 'address', key];
  need(at('line1'), address?.line1, 'Enter the street address');
  need(at('city'), address?.city, 'Enter the city');
  need(at('state'), address?.state, 'Choose the state');
  need(at('postalCode'), address?.postalCode, 'Enter the ZIP code');
  if ((address?.country ?? 'US') === 'US') {
    if (address?.state && !(address.state.toUpperCase() in US_STATES)) {
      out.push({ path: at('state'), message: 'Choose the state' });
    }
    if (address?.postalCode && !/^\d{5}(-\d{4})?$/.test(address.postalCode)) {
      out.push({ path: at('postalCode'), message: 'Enter a 5-digit ZIP code' });
    }
  }
  if (body.accountType === 'BUSINESS') {
    need(['profile', 'businessName'], body.profile?.businessName, 'Enter the business name');
    const party = body.profile?.responsibleParty;
    const rp = (key: string) => ['profile', 'responsibleParty', key];
    need(rp('name'), party?.name, "Enter the responsible party's full name");
    need(rp('email'), party?.email, "Enter the responsible party's email");
    need(rp('phone'), party?.phone, "Enter the responsible party's phone");
  }
  return out;
}

/** The firm's new-client form (Octavia's D1 and E5): CreateClientRequest plus clientFormIssues. */
export const NewClientForm = CreateClientRequest.superRefine((body, ctx) => {
  for (const issue of clientFormIssues(body)) ctx.addIssue({ code: 'custom', ...issue });
});
export type NewClientForm = z.input<typeof NewClientForm>;

/** PATCH /business/clients/{id}. `null` or `''` clears email or phone; the assignee is Owner/Admin. */
export const UpdateClientRequest = z
  .strictObject({
    accountType: ClientAccountType.optional(),
    displayName: text(200, 'one', 'Enter a name').optional(),
    email: clearable(Email),
    phone: clearable(Phone),
    assignedUserId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), 'Change at least one field');
export type UpdateClientRequest = z.input<typeof UpdateClientRequest>;

// ---------- Tax status per year (firm) ----------
export const TaxStatusRef = z.object({ id: z.uuid(), name: z.string() });

/** One tax year of a client: the firm's status for it and the note the client sees. */
export const ClientTaxYear = z.object({
  taxYear: z.number().int(),
  status: TaxStatusRef,
  /** Shown to the client in the portal. */
  clientNote: z.string().nullable(),
  updatedBy: MemberRef.nullable(),
  updatedAt: DateTime,
});
export type ClientTaxYear = z.infer<typeof ClientTaxYear>;

/** GET /business/clients/{id}/tax-years: newest year first. */
export const ClientTaxYearList = z.object({ items: z.array(ClientTaxYear) });

/** PUT /business/clients/{id}/tax-years/{year}: sets (or first adds) that year's status. */
export const SetClientTaxYearRequest = z.strictObject({
  taxStatusId: z.uuid(),
  clientNote: clearable(text(1000, 'many')),
});
export type SetClientTaxYearRequest = z.input<typeof SetClientTaxYearRequest>;

/** GET /business/clients/{id}/tax-years/{year}/history: newest first. */
export const ClientTaxYearHistory = z.object({
  items: z.array(
    z.object({
      status: TaxStatusRef,
      clientNote: z.string().nullable(),
      changedBy: MemberRef.nullable(),
      changedAt: DateTime,
    }),
  ),
});
export type ClientTaxYearHistory = z.infer<typeof ClientTaxYearHistory>;

// ---------- The client's own record (portal) ----------
/**
 * GET /portal/{firmSlug}/me/profile (mockup "My Profile"). Name and date of birth are locked.
 * Spouse and authorized logins see the record without the date of birth (null) and cannot edit
 * it (`portalRole` tells the screen to hide the controls).
 */
/**
 * GET /portal/{firmSlug}/me/profile. The date of birth is the primary login's only. An AUTHORIZED
 * login sees the name only (Rasel's q21): every other field reads as empty, as for a client with
 * nothing on file, and `email` is always the signed-in login's own.
 */
export const MyProfile = z.object({
  portalRole: ClientPortalRole,
  fullName: z.string(),
  dateOfBirth: CalendarDate.nullable(),
  /**
   * True when a date of birth is on file but can't be read right now (no firm key, KMS down, a
   * damaged value): `dateOfBirth` is then null, and the portal shows it as unavailable and asks
   * the client to contact the firm.
   */
  dateOfBirthUnavailable: z.boolean(),
  /** The login email; changing it is an account (sign-in) change, not a profile edit. */
  email: z.string(),
  phone: z.string().nullable(),
  address: Address,
  preferredContactMethod: ContactMethod.nullable(),
  referralSource: z.string().nullable(),
  additionalInfo: z.string().nullable(),
});
export type MyProfile = z.infer<typeof MyProfile>;

/**
 * PATCH /portal/{firmSlug}/me/profile ("Save Changes"), the primary login only (403 otherwise).
 * Name and date of birth are not here. `null` or `''` clears a field.
 */
export const UpdateMyProfileRequest = z
  .strictObject({
    phone: clearable(Phone),
    address: AddressInput.optional(),
    preferredContactMethod: clearable(ContactMethod),
    referralSource: clearable(text(200)),
    additionalInfo: clearable(text(2000, 'many')),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), 'Change at least one field');
export type UpdateMyProfileRequest = z.input<typeof UpdateMyProfileRequest>;

/** POST /portal/{firmSlug}/me/profile/name-change: a task for the firm's staff (primary login). */
export const RequestNameChangeRequest = z.strictObject({
  newName: text(200, 'one', 'Enter the new name'),
  reason: clearable(text(500, 'many')),
});
export type RequestNameChangeRequest = z.input<typeof RequestNameChangeRequest>;

/** GET /portal/{firmSlug}/me/tax-years: the status name and note per year, newest first. */
export const MyTaxYearList = z.object({
  items: z.array(
    z.object({
      taxYear: z.number().int(),
      status: z.string(),
      clientNote: z.string().nullable(),
      updatedAt: DateTime,
    }),
  ),
});
export type MyTaxYearList = z.infer<typeof MyTaxYearList>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const ClientErrorCode = z.enum([
  /** 409: another client of the firm has this email. */
  'DUPLICATE_EMAIL',
  /** 409: the record is archived; restore it first. */
  'CLIENT_ARCHIVED',
  /** 409: the tax status is archived and cannot be assigned. */
  'TAX_STATUS_ARCHIVED',
  /** 409: a name change request is already open. */
  'NAME_CHANGE_PENDING',
  /**
   * 503: SSN, EIN and date of birth can't be saved right now (no firm key yet, KMS down). Reads
   * never fail for it: an unreadable date of birth is null with `dateOfBirthUnavailable`.
   */
  'ENCRYPTION_UNAVAILABLE',
]);
export type ClientErrorCode = z.infer<typeof ClientErrorCode>;
