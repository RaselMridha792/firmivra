import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import {
  CalendarFamily,
  CalendarRuleKind,
  CalendarStatus,
  DeadlineType,
  JurisdictionLevel,
} from '../db-enums.js';
import {
  ComplianceDay,
  ComplianceDateTime,
  CompliancePage,
  ComplianceStateCode,
  compliancePageQuery,
} from './schemas.js';

// The Calendar Library (Frame 3: Import Government Calendar, Calendar Library): versioned official
// calendars of the firm, each with its authority, jurisdiction, effective year, source URL and
// last-verified date. Importing makes a DRAFT; a DRAFT is verified, then published (which
// supersedes the published version of the same family, authority, state and year, kept for
// rollback). A failed import never touches the published version, and a date is never invented:
// an entry whose date is not known is NEEDS_VERIFICATION and blocks verifying. Owner and Admin
// change the library; Staff read it.

const Int = z.number().int();

export const ComplianceCalendarId = z.uuid();
export const ComplianceCalendarEntryId = z.uuid();

/** How a FORMULA entry gives its date: the `day` of the month `monthsAfterYearEnd` months after the year end. */
export const ComplianceFormulaRule = z.strictObject({
  monthsAfterYearEnd: z.number().int().min(0).max(12),
  day: z.number().int().min(1).max(31),
});
export type ComplianceFormulaRule = z.infer<typeof ComplianceFormulaRule>;

const entryBase = {
  name: text(200),
  type: DeadlineType,
  form: text(60).nullable().optional(),
  description: text(1000, 'many').nullable().optional(),
};

/** One deadline of a calendar version: a fixed date, a formula, or "needs verification" (no date). */
export const ComplianceCalendarEntryInput = z.discriminatedUnion('ruleKind', [
  z.strictObject({
    ...entryBase,
    ruleKind: z.literal('FIXED_DATE'),
    dueOn: ComplianceDay,
  }),
  z.strictObject({
    ...entryBase,
    ruleKind: z.literal('FORMULA'),
    rule: ComplianceFormulaRule,
  }),
  z.strictObject({
    ...entryBase,
    ruleKind: z.literal('NEEDS_VERIFICATION'),
  }),
]);
export type ComplianceCalendarEntryInput = z.input<typeof ComplianceCalendarEntryInput>;

export const ComplianceCalendarEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  type: DeadlineType,
  form: z.string().nullable(),
  description: z.string().nullable(),
  ruleKind: CalendarRuleKind,
  dueOn: ComplianceDay.nullable(),
  rule: ComplianceFormulaRule.nullable(),
});
export type ComplianceCalendarEntry = z.infer<typeof ComplianceCalendarEntry>;

export const ComplianceCalendarRow = z.object({
  id: z.uuid(),
  family: CalendarFamily,
  authority: z.string(),
  jurisdiction: JurisdictionLevel,
  state: ComplianceStateCode.nullable(),
  effectiveYear: Int,
  version: Int,
  name: z.string(),
  sourceUrl: z.string(),
  retrievedAt: ComplianceDateTime.nullable(),
  verifiedAt: ComplianceDateTime.nullable(),
  status: CalendarStatus,
  publishedAt: ComplianceDateTime.nullable(),
  entryCount: Int,
  /** Entries with no date yet. */
  needsVerificationCount: Int,
  /** In use (published) and last verified longer ago than the firm's stale limit, or never: the stale-calendar warning. */
  stale: z.boolean(),
  createdAt: ComplianceDateTime,
});
export type ComplianceCalendarRow = z.infer<typeof ComplianceCalendarRow>;

export const ComplianceCalendar = ComplianceCalendarRow.extend({
  entries: z.array(ComplianceCalendarEntry),
});
export type ComplianceCalendar = z.infer<typeof ComplianceCalendar>;

/** GET /business/compliance/calendars. */
export const ComplianceCalendarsQuery = z.strictObject({
  status: CalendarStatus.optional(),
  family: CalendarFamily.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  state: ComplianceStateCode.optional(),
  /** Name or authority. */
  search: SearchText.optional(),
  ...compliancePageQuery(25),
});
export type ComplianceCalendarsQuery = z.input<typeof ComplianceCalendarsQuery>;

export const ComplianceCalendarPage = z.object({
  items: z.array(ComplianceCalendarRow).max(100),
  ...CompliancePage,
});
export type ComplianceCalendarPage = z.infer<typeof ComplianceCalendarPage>;

const Https = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/[^\s]+$/, 'Use the official page, starting with https://');

const calendarFields = {
  family: CalendarFamily,
  authority: text(120),
  jurisdiction: JurisdictionLevel,
  state: ComplianceStateCode.nullable().optional(),
  effectiveYear: z.number().int().min(2000).max(2100),
  name: text(200),
  sourceUrl: Https,
  /** When the dates were taken from the source. */
  retrievedAt: ComplianceDateTime.optional(),
  entries: z.array(ComplianceCalendarEntryInput).max(500),
};

const entriesAreUnique = (entries: readonly ComplianceCalendarEntryInput[]) =>
  new Set(entries.map((e) => `${e.name}|${e.ruleKind === 'FIXED_DATE' ? e.dueOn : ''}`)).size ===
  entries.length;

/**
 * POST /business/compliance/calendars (an import) and /calendars/import-preview. Makes a new
 * DRAFT version of the family, authority, state and year (version 1, 2, 3...). Federal calendars
 * have no state.
 */
export const ImportComplianceCalendarRequest = z
  .strictObject(calendarFields)
  .refine((b) => b.jurisdiction !== 'FEDERAL' || !b.state, {
    message: 'A federal calendar has no state',
    path: ['state'],
  })
  .refine((b) => entriesAreUnique(b.entries), {
    message: 'Each entry needs its own name and date',
    path: ['entries'],
  });
export type ImportComplianceCalendarRequest = z.input<typeof ImportComplianceCalendarRequest>;

/** PATCH /business/compliance/calendars/{id}: only while DRAFT. */
export const UpdateComplianceCalendarRequest = z
  .strictObject({
    name: calendarFields.name,
    sourceUrl: calendarFields.sourceUrl,
    retrievedAt: ComplianceDateTime.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field');
export type UpdateComplianceCalendarRequest = z.input<typeof UpdateComplianceCalendarRequest>;

/** PATCH .../calendars/{id}/entries/{entryId}: only while DRAFT; give the whole rule when changing its kind. */
export const UpdateComplianceCalendarEntryRequest = z
  .strictObject({
    name: entryBase.name,
    type: entryBase.type,
    form: entryBase.form,
    description: entryBase.description,
    ruleKind: CalendarRuleKind,
    dueOn: ComplianceDay.nullable(),
    rule: ComplianceFormulaRule.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field');
export type UpdateComplianceCalendarEntryRequest = z.input<
  typeof UpdateComplianceCalendarEntryRequest
>;

// ---------- Comparing versions ----------

export const ComplianceCalendarRef = z.object({
  id: z.uuid(),
  name: z.string(),
  version: Int,
  status: CalendarStatus,
  effectiveYear: Int,
});
export type ComplianceCalendarRef = z.infer<typeof ComplianceCalendarRef>;

export const ComplianceDiffChange = z.enum(['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED']);
export type ComplianceDiffChange = z.infer<typeof ComplianceDiffChange>;

const DiffSide = z.object({
  type: DeadlineType,
  description: z.string().nullable(),
  ruleKind: CalendarRuleKind,
  dueOn: ComplianceDay.nullable(),
  rule: ComplianceFormulaRule.nullable(),
});

export const ComplianceDiffEntry = z.object({
  change: ComplianceDiffChange,
  name: z.string(),
  form: z.string().nullable(),
  /** In the published (older) version; null for an added entry. */
  before: DiffSide.nullable(),
  /** In the new version; null for a removed entry. */
  after: DiffSide.nullable(),
  /** CHANGED or REMOVED entries whose deadlines the firm overrode: they need a review before publishing. */
  overriddenDeadlines: Int,
});
export type ComplianceDiffEntry = z.infer<typeof ComplianceDiffEntry>;

/**
 * GET .../calendars/{id}/compare/{otherId} (what changed from the other version to this one) and
 * POST .../calendars/import-preview (an import against the published version: `to` is null; `from`
 * is null when nothing is published for that family, authority, state and year).
 */
export const ComplianceCalendarDiff = z.object({
  from: ComplianceCalendarRef.nullable(),
  to: ComplianceCalendarRef.nullable(),
  counts: z.object({ added: Int, changed: Int, removed: Int, unchanged: Int }),
  /** Changed or removed entries with overridden deadlines (the conflicts that need review). */
  conflicts: Int,
  /** Every entry, in name order. */
  entries: z.array(ComplianceDiffEntry),
});
export type ComplianceCalendarDiff = z.infer<typeof ComplianceCalendarDiff>;
