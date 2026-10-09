import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { CalendarDate, ContactMethod } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { BusinessSummary } from '../schemas.js';

// Firm applications (R4): a business applies on the firm site without an account; a Firmivra
// Super Admin reviews it, requests information, approves or declines; approval creates the firm
// (PENDING_SETUP) and invites the primary administrator as its owner, whose setup Finish makes it
// ACTIVE. Plus the Super Admin's firms list and dashboard counts.
// Public route: POST /api/v1/firm-applications. Super Admin routes: /api/v1/admin/... (the
// Super Admin site's session only).
// EIN: an application never stores it in full (the firm's encryption key doesn't exist yet). The
// API keeps the last 4 digits and a keyed hash for the duplicate check, in columns of their own
// (never in the stored form); the owner enters the full EIN again in setup step 2.
// Responses are plain objects (a field the API adds later is dropped, so an open page keeps
// working); requests are strict (unknown fields are refused).

const DateTime = z.iso.datetime({ offset: true });

/** `{ CODE: 'Label' }` to a z.enum of its codes. */
const codes = <T extends Record<string, string>>(labels: T) =>
  z.enum(Object.keys(labels) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]]);

// ---------- Choice lists ----------
// One list each: code (stored) and label (shown). Octavia confirms them; until then a change is one
// line here. Never remove a code that applications use; add a new one instead.

export const PRACTICE_TYPES = {
  TAX_ACCOUNTING: 'Tax & Accounting',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  BUSINESS_CONSULTING: 'Business Consulting',
  OTHER: 'Other',
} as const;
export const PracticeType = codes(PRACTICE_TYPES);
export type PracticeType = z.infer<typeof PracticeType>;

export const ENTITY_TYPES = {
  SOLE_PROPRIETOR: 'Sole proprietor',
  LLC: 'LLC',
  S_CORP: 'S-Corp',
  C_CORP: 'C-Corp',
  PARTNERSHIP: 'Partnership',
  NONPROFIT: 'Nonprofit',
} as const;
export const EntityType = codes(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const FIRM_SERVICES = {
  TAX_PREPARATION: 'Tax Preparation',
  TAX_PLANNING: 'Tax Planning',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  BUSINESS_CONSULTING: 'Business Consulting',
  BUSINESS_DEVELOPMENT: 'Business Development',
} as const;
export const FirmService = codes(FIRM_SERVICES);
export type FirmService = z.infer<typeof FirmService>;

export const FIRM_PLANS = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
} as const;
export const FirmPlan = codes(FIRM_PLANS);
export type FirmPlan = z.infer<typeof FirmPlan>;

/** Estimated clients per year. */
export const CLIENT_VOLUMES = {
  UNDER_100: 'Fewer than 100',
  FROM_100: '100 to 249',
  FROM_250: '250 to 499',
  FROM_500: '500+',
} as const;
export const ClientVolume = codes(CLIENT_VOLUMES);
export type ClientVolume = z.infer<typeof ClientVolume>;

export const CREDENTIAL_TYPES = {
  PTIN: 'PTIN',
  EFIN: 'EFIN',
  CPA_LICENSE: 'CPA license',
  ENROLLED_AGENT: 'Enrolled Agent (EA)',
  ATTORNEY: 'Attorney (bar number)',
  OTHER: 'Other',
} as const;
export const CredentialType = codes(CREDENTIAL_TYPES);
export type CredentialType = z.infer<typeof CredentialType>;

/**
 * The credentials an applicant must list for each practice type (the spec: "use the selection to
 * determine any required credential fields"). Empty until Octavia says which.
 */
export const REQUIRED_CREDENTIALS: Readonly<Record<PracticeType, readonly CredentialType[]>> = {
  TAX_ACCOUNTING: [],
  BOOKKEEPING: [],
  PAYROLL: [],
  BUSINESS_CONSULTING: [],
  OTHER: [],
};

// ---------- Fields ----------
/**
 * 9 digits; dashes and spaces are dropped. Write-only: only `einLast4` ever comes back. Setup
 * Step 2 (settings) takes the EIN with the same rule.
 */
export const Ein = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{9}$/, 'Enter the 9-digit EIN'));

/** A website without `http://` or `https://` is read as `https://`. */
const withScheme = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

/** An http(s) address; `example.com` becomes `https://example.com`. */
const Website = z
  .string()
  .trim()
  .transform(withScheme)
  .pipe(
    z
      .url({ protocol: /^https?$/, hostname: z.regexes.domain, error: 'Enter a valid website' })
      .max(200, 'Use at most 200 characters'),
  );

/**
 * The host of a website read the way the Website field reads it (`example.com` is
 * `https://example.com`), or null when that isn't a URL whose host is a domain name, which the
 * field refuses (`N/A`, `ftp://example.com`). For a stored website, which the database doesn't
 * check: the EMAIL_DOMAIN check reads it with this.
 */
export function websiteHost(website: string): string | null {
  const url = withScheme(website.trim());
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  return z.regexes.domain.test(host) ? host : null;
}

/** A US address (the beta serves US firms only). */
const AddressInput = z.strictObject({
  line1: text(200, 'one', 'Enter the street address'),
  line2: clearable(text(200)),
  city: text(100, 'one', 'Enter the city'),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter state code'),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid ZIP code'),
});

export const FirmAddress = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
});
export type FirmAddress = z.infer<typeof FirmAddress>;

// ---------- Submit (public) ----------
/**
 * POST /firm-applications ("Create a Business Account"; no sign-in). Grouped like the review page.
 * Optional fields: leave them out, or send `null` or `''`.
 */
export const SubmitFirmApplicationRequest = z
  .strictObject({
    business: z.strictObject({
      practiceType: PracticeType,
      /** Becomes the firm's name, locked after approval. */
      legalName: text(200, 'one', 'Enter the legal business name'),
      dbaName: clearable(text(200)),
      entityType: EntityType,
      ein: clearable(Ein),
      email: clearable(Email),
      phone: clearable(Phone),
      website: clearable(Website),
      address: AddressInput,
      services: z
        .array(FirmService)
        .min(1, 'Choose at least one service')
        .max(20)
        .transform((list) => [...new Set(list)]),
    }),
    /** The person who becomes the firm's owner (first Firm Admin) after approval. */
    primaryAdmin: z.strictObject({
      /** At most 120 characters on one line: the owner invite's name rule (#52's invites_name). */
      fullName: text(120, 'one', 'Enter the full name'),
      email: Email,
      phone: Phone,
      title: clearable(text(100)),
      preferredContact: ContactMethod.optional().default('EMAIL'),
      alternatePhone: clearable(Phone),
    }),
    account: z.strictObject({
      requestedPlan: FirmPlan,
      teamSize: z
        .number('Enter the team size')
        .int('Enter a whole number')
        .min(1, 'Enter at least 1')
        .max(10_000),
      clientVolume: ClientVolume,
      heardFrom: clearable(text(200)),
      /** Empty means "as soon as possible". */
      requestedStartDate: clearable(CalendarDate),
      additionalInfo: clearable(text(2000, 'many')),
    }),
    credentials: z
      .array(
        z.strictObject({
          type: CredentialType,
          number: text(50, 'one', 'Enter the credential number'),
          issuedBy: clearable(text(100)),
        }),
      )
      .max(20)
      .optional()
      .default([]),
    /**
     * Both must be ticked before the form can be sent. The API records the version of Firmivra's
     * terms in force with the application.
     */
    agreement: z.strictObject({
      acceptedTerms: z.literal(true, 'Accept the terms to continue'),
      certifiedAccurate: z.literal(true, 'Confirm that the information is accurate'),
    }),
    /**
     * The form's bot trap: an input people never see (off screen, `tabIndex={-1}`,
     * `autoComplete="off"`, `aria-hidden`, with an everyday name such as `fax`). Send its value as
     * it is. A filled one gets the same `{ received: true }` and the application is dropped.
     */
    // No length limit of its own (the body limit applies): a 400 naming the field would tip off a bot.
    honeypot: z.string().optional(),
  })
  .superRefine((body, ctx) => {
    for (const type of REQUIRED_CREDENTIALS[body.business.practiceType]) {
      if (!body.credentials.some((c) => c.type === type)) {
        ctx.addIssue({
          code: 'custom',
          path: ['credentials'],
          message: `Add your ${CREDENTIAL_TYPES[type]}`,
        });
      }
    }
  });
export type SubmitFirmApplicationRequest = z.input<typeof SubmitFirmApplicationRequest>;

/**
 * Always the same answer, also for a repeat or an email that already has an account, so the form
 * never tells anyone who has applied. 429 RATE_LIMITED after too many from one address.
 */
export const SubmitFirmApplicationResponse = z.object({ received: z.literal(true) });
export type SubmitFirmApplicationResponse = z.infer<typeof SubmitFirmApplicationResponse>;

// ---------- Review (Super Admin) ----------
/**
 * An application's id, in a response or a path (anything else in a path gets 400
 * VALIDATION_FAILED). Seeded ids are RFC 9562 too since R0's #89 (LVP's application is
 * `00000000-0000-4005-8000-000000000001`).
 */
export const FirmApplicationId = z.uuid();
/** A firm (business) id in a path. */
export const FirmId = z.uuid();

/**
 * An application's status as the API returns it. Request Information keeps it PENDING_REVIEW (the
 * applicant answers by email and the Super Admin records it in the notes); approve and decline are
 * final. The database's FirmApplicationStatus also has INFO_REQUESTED, which Phase 1 never sets.
 */
export const FirmApplicationReviewStatus = z.enum(['PENDING_REVIEW', 'APPROVED', 'DECLINED']);
export type FirmApplicationReviewStatus = z.infer<typeof FirmApplicationReviewStatus>;

/** A Firmivra Super Admin shown next to a decision or a history entry. */
export const AdminRef = z.object({ userId: z.uuid(), name: z.string() });
export type AdminRef = z.infer<typeof AdminRef>;

/** One row of the applications list (mockup "Firm Applications"). */
export const FirmApplicationListItem = z.object({
  id: FirmApplicationId,
  status: FirmApplicationReviewStatus,
  legalName: z.string(),
  dbaName: z.string().nullable(),
  /**
   * False when the stored form could not be read: the row shows what the table's own columns hold
   * (names, contact, dates, status). The practice type, entity type and plan are then null and
   * `services` is empty; the screen shows "—" for them.
   */
  formReadable: z.boolean(),
  practiceType: PracticeType.nullable(),
  entityType: EntityType.nullable(),
  services: z.array(FirmService),
  requestedPlan: FirmPlan.nullable(),
  /** The primary administrator. */
  contactName: z.string(),
  contactEmail: z.string(),
  /** Null only when the form could not be read and the application has no phone of its own. */
  contactPhone: z.string().nullable(),
  submittedAt: DateTime,
  /** When it was approved or declined. */
  decidedAt: DateTime.nullable(),
});
export type FirmApplicationListItem = z.infer<typeof FirmApplicationListItem>;

/**
 * GET /admin/firm-applications. Search matches the legal name, DBA, contact name and email.
 * `from` and `to` bound the submission time (`to` exclusive); the screen turns "Last 30 days"
 * into these in the viewer's time zone.
 */
export const ListFirmApplicationsQuery = z
  .strictObject({
    status: FirmApplicationReviewStatus.optional(),
    search: SearchText.optional(),
    from: DateTime.optional(),
    to: DateTime.optional(),
    order: z.enum(['newest', 'oldest']).optional().default('newest'),
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to),
    'The start must be before the end',
  );
export type ListFirmApplicationsQuery = z.input<typeof ListFirmApplicationsQuery>;

/** Numbered pages ("Showing 1 of 1 applications"). */
const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });

export const ListFirmApplicationsResponse = page(FirmApplicationListItem);
export type ListFirmApplicationsResponse = z.infer<typeof ListFirmApplicationsResponse>;

/**
 * GET /admin/firm-applications/counts: the stat cards and the tab counts, without filters.
 * "This month" is the calendar month in US Eastern time.
 */
export const FirmApplicationCounts = z.object({
  all: z.number().int().min(0),
  pendingReview: z.number().int().min(0),
  approved: z.number().int().min(0),
  declined: z.number().int().min(0),
  approvedThisMonth: z.number().int().min(0),
  declinedThisMonth: z.number().int().min(0),
});
export type FirmApplicationCounts = z.infer<typeof FirmApplicationCounts>;

/**
 * Checks the API runs when the application is opened. WARN asks the Super Admin to look; it never
 * blocks an action.
 */
export const FirmApplicationCheck = z.object({
  key: z.enum([
    /**
     * Another application has the same EIN (keyed hash; a firm keeps its EIN encrypted with its
     * own key, so firms aren't compared). SKIPPED without an EIN.
     */
    'DUPLICATE_EIN',
    /** Another application or firm has the same legal name. */
    'DUPLICATE_NAME',
    /** Another application uses the primary administrator's email. */
    'DUPLICATE_EMAIL',
    /**
     * The administrator's email domain matches the website. A free email address (Gmail, Outlook
     * and the like) is a WARN whatever the website; SKIPPED without a website, or when the stored
     * one isn't an address with a domain name (`websiteHost`).
     */
    'EMAIL_DOMAIN',
  ]),
  result: z.enum(['PASS', 'WARN', 'SKIPPED']),
  /** One sentence for the screen, e.g. "Same EIN as Example Payroll Group (declined)". */
  note: z.string(),
});
export type FirmApplicationCheck = z.infer<typeof FirmApplicationCheck>;

/** One entry of "Application History" (and the firm's "Recent Activity"), newest first. */
export const FirmApplicationEvent = z.object({
  type: z.enum([
    'SUBMITTED',
    /** `message`: what was asked. */
    'INFO_REQUESTED',
    'APPROVED',
    /** `message`: the reason. */
    'DECLINED',
    /** The owner's activation link was sent (on approval, or sent again). */
    'OWNER_INVITED',
    /** The owner finished setup; the firm is ACTIVE. */
    'FIRM_ACTIVATED',
  ]),
  at: DateTime,
  /** The Super Admin who acted; null for the applicant and the owner. */
  by: AdminRef.nullable(),
  message: z.string().nullable(),
});
export type FirmApplicationEvent = z.infer<typeof FirmApplicationEvent>;

/**
 * GET /admin/firm-applications/{id}: the review page, every field the applicant sent.
 *
 * `formReadable` false: the stored form could not be read (an older or hand-edited application).
 * `business`, `primaryAdmin` and `account` are then null and `credentials` is empty. The page shows
 * the top-level name and contact fields in the Business Information and Primary Administrator
 * cards, "The application form could not be read" in place of the other details and the Account
 * Details card, and the checks, notes, history and actions as usual.
 */
export const FirmApplicationRecord = z.object({
  id: FirmApplicationId,
  status: FirmApplicationReviewStatus,
  submittedAt: DateTime,
  /**
   * The table's own columns, there whatever the stored form holds: the legal name and DBA, and the
   * primary administrator's name, email and phone.
   */
  legalName: z.string(),
  dbaName: z.string().nullable(),
  contactName: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string().nullable(),
  /** False when the stored form could not be read (see above). */
  formReadable: z.boolean(),
  /** Null when `formReadable` is false. */
  business: z
    .object({
      practiceType: PracticeType,
      legalName: z.string(),
      dbaName: z.string().nullable(),
      entityType: EntityType,
      /**
       * The only part of the EIN the API keeps, from a column of its own (`ein_last4`), never from
       * the stored form. Null when the application has no EIN.
       */
      einLast4: z
        .string()
        .regex(/^\d{4}$/)
        .nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      website: z.string().nullable(),
      address: FirmAddress,
      services: z.array(FirmService),
    })
    .nullable(),
  /** Null when `formReadable` is false. */
  primaryAdmin: z
    .object({
      fullName: z.string(),
      email: z.string(),
      phone: z.string(),
      title: z.string().nullable(),
      preferredContact: ContactMethod,
      alternatePhone: z.string().nullable(),
    })
    .nullable(),
  /** Null when `formReadable` is false. */
  account: z
    .object({
      requestedPlan: FirmPlan,
      teamSize: z.number().int(),
      clientVolume: ClientVolume,
      heardFrom: z.string().nullable(),
      /** Null: as soon as possible. */
      requestedStartDate: CalendarDate.nullable(),
      additionalInfo: z.string().nullable(),
    })
    .nullable(),
  /** Empty when `formReadable` is false. */
  credentials: z.array(
    z.object({ type: CredentialType, number: z.string(), issuedBy: z.string().nullable() }),
  ),
  /** Uploaded files; always empty until uploads exist (R5). */
  documents: z.array(
    z.object({ id: z.uuid(), name: z.string(), fileName: z.string(), uploadedAt: DateTime }),
  ),
  checks: z.array(FirmApplicationCheck),
  /** Only Firmivra administrators see these. */
  internalNotes: z.string().nullable(),
  /** Set once approved or declined. `reason`: the decline reason; null when approved. */
  decision: z
    .object({ by: AdminRef.nullable(), at: DateTime, reason: z.string().nullable() })
    .nullable(),
  /**
   * The free portal address approve uses unless the Super Admin picks another: PENDING_REVIEW, or
   * APPROVED while `firm` is null.
   */
  suggestedSlug: z.string().nullable(),
  /** APPROVED: the firm it created. */
  firm: BusinessSummary.nullable(),
  /** APPROVED: the owner's activation link (7 days). ACCEPTED once they have signed in. */
  ownerInvite: z
    .object({ status: z.enum(['SENT', 'EXPIRED', 'ACCEPTED']), expiresAt: DateTime })
    .nullable(),
  history: z.array(FirmApplicationEvent),
});
export type FirmApplicationRecord = z.infer<typeof FirmApplicationRecord>;

/**
 * Portal addresses no firm may have: the site's own paths and names kept for Firmivra. The API and
 * the approve dialog use this list.
 */
export const RESERVED_FIRM_SLUGS: readonly string[] = [
  '_next',
  'admin',
  'api',
  'app',
  'apply',
  'dev',
  'help',
  'portal',
  'sign-in',
  'static',
  'status',
  'support',
  'welcome',
  'www',
];

/**
 * A new firm's portal address, as the database allows it (businesses_slug_format): lower-case
 * letters and digits with single inner hyphens, at most 63 characters, and not reserved.
 */
export const NewFirmSlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(63, 'Use at most 63 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and single hyphens')
  .refine((slug) => !RESERVED_FIRM_SLUGS.includes(slug), 'This address is reserved');

/**
 * POST /admin/firm-applications/{id}/approve. Creates the firm (PENDING_SETUP, named after the
 * legal name) at `slug` (default `suggestedSlug`) and emails the primary administrator an owner
 * activation link. 409 APPLICATION_DECIDED, SLUG_TAKEN or OWNER_NAME_TOO_LONG. If the firm could
 * not be created (its address was taken in between: SLUG_TAKEN after the decision), the
 * application is APPROVED with `firm` null and `suggestedSlug` set; approving it again finishes.
 */
export const ApproveFirmApplicationRequest = z.strictObject({ slug: NewFirmSlug.optional() });
export type ApproveFirmApplicationRequest = z.input<typeof ApproveFirmApplicationRequest>;

/**
 * POST /admin/firm-applications/{id}/request-info: emails `message` to the applicant, who replies
 * to Firmivra support. Stays PENDING_REVIEW. The same message as the last request changes nothing
 * and is not sent again. 409 APPLICATION_DECIDED.
 */
export const RequestFirmInfoRequest = z.strictObject({
  message: text(2000, 'many', 'Enter what you need from the applicant'),
});
export type RequestFirmInfoRequest = z.input<typeof RequestFirmInfoRequest>;

/**
 * POST /admin/firm-applications/{id}/decline. The reason is emailed to the applicant: label the
 * field "Reason (sent to the applicant)"; internal remarks go in the notes. It must differ from the
 * last information request (400 VALIDATION_FAILED, checked after the application is found).
 * 409 APPLICATION_DECIDED.
 */
export const DeclineFirmApplicationRequest = z.strictObject({
  reason: text(1000, 'many', 'Enter the reason'),
});
export type DeclineFirmApplicationRequest = z.input<typeof DeclineFirmApplicationRequest>;

/** PUT /admin/firm-applications/{id}/notes ("Save Note"): replaces the notes; `''` clears them. */
export const SaveFirmNotesRequest = z.strictObject({
  notes: z
    .string()
    .trim()
    .max(5000, 'Use at most 5000 characters')
    .regex(/^(?:[^\p{Cc}]|[\t\n\r])*$/u, 'Remove the special characters')
    .transform((s) => (s === '' ? null : s))
    .nullable(),
});
export type SaveFirmNotesRequest = z.input<typeof SaveFirmNotesRequest>;

// ---------- Firms (Super Admin) ----------
/** The firms page's filter: INACTIVE is SUSPENDED or CLOSED. */
export const FirmStatusFilter = z.enum(['ACTIVE', 'PENDING_SETUP', 'INACTIVE']);
export type FirmStatusFilter = z.infer<typeof FirmStatusFilter>;

/** One row of the firms list (mockup "Firms"). */
export const FirmListItem = BusinessSummary.extend({
  /**
   * The firm's owner (or, before activation, the invited primary administrator). Null when neither
   * is known, e.g. before activation when the application's form could not be read.
   */
  owner: z.object({ name: z.string(), email: z.string(), phone: z.string().nullable() }).nullable(),
  /**
   * The plan the application asked for; null for a firm without an application, or when its form
   * could not be read.
   */
  plan: FirmPlan.nullable(),
  approvedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type FirmListItem = z.infer<typeof FirmListItem>;

/** GET /admin/firms. Search matches the firm name, owner name and owner email. Newest first. */
export const ListFirmsQuery = z.strictObject({
  status: FirmStatusFilter.optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ListFirmsQuery = z.input<typeof ListFirmsQuery>;

export const ListFirmsResponse = page(FirmListItem);
export type ListFirmsResponse = z.infer<typeof ListFirmsResponse>;

/** GET /admin/firms/counts: the stat cards. */
export const FirmCounts = z.object({
  active: z.number().int().min(0),
  pendingSetup: z.number().int().min(0),
  inactive: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type FirmCounts = z.infer<typeof FirmCounts>;

/**
 * GET /admin/firms/{id}: the firm page. Its details, notes and activity are its application's
 * (null for a firm created without one, such as the beta firm); notes are saved on the application.
 * An application whose form could not be read has `formReadable` false, as on its review page.
 */
export const FirmRecord = FirmListItem.extend({ application: FirmApplicationRecord.nullable() });
export type FirmRecord = z.infer<typeof FirmRecord>;

// ---------- Dashboard (Super Admin) ----------
/** GET /admin/dashboard: the stat cards and "Tasks Requiring Attention". */
export const AdminDashboard = z.object({
  pendingApplications: z.number().int().min(0),
  activeFirms: z.number().int().min(0),
  /**
   * Staff and client logins across every firm (Super Admins not counted). Null until R0's
   * platform count exists (admin scope cannot read members or clients).
   */
  totalUsers: z.number().int().min(0).nullable(),
  /** Of those, created in the last 7 days; null like `totalUsers`. */
  newUsersThisWeek: z.number().int().min(0).nullable(),
  /** In cents; null until billing exists (R7). */
  monthlyRevenueCents: z.number().int().nullable(),
});
export type AdminDashboard = z.infer<typeof AdminDashboard>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const FirmApplicationErrorCode = z.enum([
  /** 409: the application is already approved or declined. */
  'APPLICATION_DECIDED',
  /** 409: another firm has this portal address. */
  'SLUG_TAKEN',
  /** 409: no owner link to send (not approved, or the owner has already signed in). */
  'INVITE_NOT_NEEDED',
  /**
   * 409 on approve: the primary administrator's name can't be used for the owner invite (over 120
   * characters, or characters the invite refuses). Only applications from before Oct 8 can hold
   * one; Phase 1 has no edit, so the applicant applies again.
   */
  'OWNER_NAME_TOO_LONG',
]);
export type FirmApplicationErrorCode = z.infer<typeof FirmApplicationErrorCode>;
