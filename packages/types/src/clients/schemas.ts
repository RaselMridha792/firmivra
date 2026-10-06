import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { AccountType, Phone } from '../client-auth/schemas.js';
import { ClientAccountStatus } from '../schemas.js';
import { clearable, text } from './text.js';

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
);

/** A client id in a path: anything else gets 400 VALIDATION_FAILED. */
export const ClientId = z.uuid();
/** A tax year in a path or body. */
export const TaxYear = z.coerce.number().int().min(2000).max(2100);

/** INDIVIDUAL or BUSINESS (database enum ClientAccountType; R3's AccountType). */
export const ClientAccountType = AccountType;
export type ClientAccountType = z.infer<typeof ClientAccountType>;
export const ContactMethod = z.enum(['EMAIL', 'PHONE', 'TEXT']);
export type ContactMethod = z.infer<typeof ContactMethod>;
/** Who a portal login is on the client's record. */
export const ClientPortalRole = z.enum(['PRIMARY', 'SPOUSE', 'AUTHORIZED']);
export type ClientPortalRole = z.infer<typeof ClientPortalRole>;

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

/**
 * GET /business/clients. Search matches the name, email and phone. Newest first. Staff get only
 * their own clients; `assignedUserId` is for Owner and Admin (403 for Staff).
 */
export const ListClientsQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  assignedUserId: z.uuid().optional(),
  /** From the previous page's nextCursor. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListClientsQuery = z.input<typeof ListClientsQuery>;

export const ListClientsResponse = z.object({
  items: z.array(ClientListItem).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ListClientsResponse = z.infer<typeof ListClientsResponse>;

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
  /** The only part of the SSN the API ever returns. */
  ssnLast4: last4,
  /** BUSINESS clients: the only part of the EIN the API ever returns. */
  einLast4: last4,
  address: Address,
  preferredContactMethod: ContactMethod.nullable(),
  referralSource: z.string().nullable(),
  additionalInfo: z.string().nullable(),
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

/**
 * PUT /business/clients/{id}/profile (firm). Send only the fields to change; `null` or `''`
 * clears one. `ssn`, `ein` (9 digits, dashes allowed) and `dateOfBirth` are stored encrypted and
 * come back only as ssnLast4, einLast4 and dateOfBirth.
 */
export const UpdateClientProfileRequest = z.strictObject({
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
});
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
  profile: UpdateClientProfileRequest.optional(),
});
export type CreateClientRequest = z.input<typeof CreateClientRequest>;

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
export const MyProfile = z.object({
  portalRole: ClientPortalRole,
  fullName: z.string(),
  dateOfBirth: CalendarDate.nullable(),
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
]);
export type ClientErrorCode = z.infer<typeof ClientErrorCode>;
