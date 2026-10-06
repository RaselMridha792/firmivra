import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { LegalDocument, LegalVersion } from '../client-auth/schemas.js';
import { BusinessStatus } from '../schemas.js';

// Firm settings (Settings > Profile, Branding, Client portal, Legal) and the first-time setup
// wizard (/setup). Owner and Admin only, also while the firm is Pending Setup.
// API: /api/v1/business/settings, /business/setup and /business/legal (lead's T02, from
// Tumit's design). Terms and Privacy use the shapes of the portal's legal reads (client-auth).

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8')
  .transform((value) => value.toLowerCase());

/** Trimmed text; an empty field is sent as null, which clears the setting. */
const clearable = (value: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((text) => (text === '' ? null : text))
    .pipe(value.nullable())
    .nullable();

/** One line: no control characters (names go into emails). */
const ONE_LINE = /^[^\p{Cc}]*$/u;
/** Several lines: tabs and line breaks only; Postgres text cannot hold NUL. */
const MULTI_LINE = /^(?:[^\p{Cc}]|[\t\n\r])*$/u;

const upTo = (max: number, lines: 'one' | 'many' = 'one') =>
  z
    .string()
    .max(max, `Use at most ${max} characters`)
    .regex(lines === 'one' ? ONE_LINE : MULTI_LINE, 'Remove the special characters');

/** IANA name such as America/New_York (or UTC); offsets and abbreviations like EST are refused. */
const IANA_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

/** The time zone's canonical spelling, or null when the runtime does not know it. */
const canonicalTimeZone = (value: string): string | null => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

/**
 * Responses are plain objects: a field the API adds later is dropped, not an error, so a page
 * already open in a browser keeps working. Requests stay strict.
 */
export const FirmSettings = z.object({
  /** Set when Firmivra approved the firm. Shown, never changed here (legal name is locked). */
  business: z.object({
    id: z.uuid(),
    /** The portal address: portal.firmivra.com/{slug}. */
    slug: z.string(),
    legalName: z.string().nullable(),
    status: BusinessStatus,
  }),
  /** The firm's name in the workspace, the portal and emails. */
  name: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  website: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  /** ISO 3166 two-letter code, for example US. */
  country: z.string(),
  /** IANA time zone, for example America/New_York. */
  timezone: z.string(),
  /** Null until R5 adds logo upload and signed URLs. */
  logoUrl: z.url().nullable(),
  /** Portal colours, `#rrggbb`. Null uses Firmivra's default. */
  primaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  /** Null: the portal is called "{name} Client Portal". */
  portalName: z.string().nullable(),
  /**
   * Heading and welcome text on the portal's landing page; null shows the default. Plain text:
   * screens show them as text, never as HTML or Markdown.
   */
  portalHeader: z.string().nullable(),
  welcomeMessage: z.string().nullable(),
  /** Clients may sign up on the portal (the firm approves each one). */
  clientSignUpEnabled: z.boolean(),
  /** The latest change to any of these settings. */
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmSettings = z.infer<typeof FirmSettings>;

/**
 * PATCH /business/settings: only the fields sent change. Identity fields (business id, slug,
 * legal name, status) and unknown fields are refused.
 */
export const UpdateFirmSettingsRequest = z
  .strictObject({
    name: z.string().trim().min(1, 'Enter a name').pipe(upTo(120)),
    contactEmail: clearable(Email),
    contactPhone: clearable(upTo(40)),
    website: clearable(
      z
        .url({
          protocol: /^https$/,
          hostname: z.regexes.domain,
          normalize: true,
          error: 'Enter a web address that starts with https://',
        })
        .max(2048, 'Use at most 2048 characters')
        .refine((url) => {
          const { username, password } = new URL(url);
          return username === '' && password === '';
        }, 'Enter a web address without a user name'),
    ),
    addressLine1: clearable(upTo(200)),
    addressLine2: clearable(upTo(200)),
    city: clearable(upTo(120)),
    state: clearable(upTo(120)),
    postalCode: clearable(upTo(32)),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
    /** Stored in its canonical spelling (america/new_york becomes America/New_York). */
    timezone: z
      .string()
      .trim()
      .max(100)
      .regex(IANA_NAME, 'Choose a time zone')
      .transform((value, ctx) => {
        const canonical = canonicalTimeZone(value);
        if (canonical) return canonical;
        ctx.addIssue({ code: 'custom', message: 'Choose a time zone' });
        return z.NEVER;
      }),
    primaryColor: clearable(HexColor),
    accentColor: clearable(HexColor),
    portalName: clearable(upTo(120)),
    portalHeader: clearable(upTo(200)),
    welcomeMessage: clearable(upTo(2000, 'many')),
    clientSignUpEnabled: z.boolean(),
  })
  .partial()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Change at least one setting',
  );
export type UpdateFirmSettingsRequest = z.input<typeof UpdateFirmSettingsRequest>;

/** The wizard's steps, in order. Finish is POST /business/setup/complete, not a step. */
export const SetupStep = z.enum(['branding', 'businessDetails', 'team', 'clientPortal']);
export type SetupStep = z.infer<typeof SetupStep>;

/** Wizard progress. The firm is Active from `completedAt` on. */
export const FirmSetup = z.object({
  /** In wizard order. */
  completedSteps: z.array(SetupStep),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type FirmSetup = z.infer<typeof FirmSetup>;

/** GET /business/legal/{kind}: the text clients see now, and every published version. */
export const FirmLegalOverview = z.object({
  /** The newest version; null until the firm publishes one. */
  current: LegalDocument.nullable(),
  /** Newest first, the current one included. */
  versions: z.array(LegalVersion),
});
export type FirmLegalOverview = z.infer<typeof FirmLegalOverview>;

/** A published version number in a path. */
export const LegalVersionNumber = z.number().int().min(1).max(2_147_483_647);

/**
 * POST /business/legal/{kind}/versions: publishes the next version, in Markdown. Every firm's
 * portal shares one origin, so screens render it with raw HTML off and only https and mailto
 * links: a script in one firm's Terms could otherwise act in another firm's portal session.
 */
export const PublishLegalDocumentRequest = z.strictObject({
  body: upTo(100_000, 'many').refine((body) => body.trim().length > 0, 'Write the text first'),
});
export type PublishLegalDocumentRequest = z.input<typeof PublishLegalDocumentRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const SettingsErrorCode = z.enum([
  /** 409: finishing needs every wizard step done first; the message names the missing ones. */
  'SETUP_INCOMPLETE',
]);
export type SettingsErrorCode = z.infer<typeof SettingsErrorCode>;
