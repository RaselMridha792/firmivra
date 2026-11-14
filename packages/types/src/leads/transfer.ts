import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { LeadPipelineQuery } from './pipeline.js';

// Leads R2 16 (Octavia, Nov 8): bulk import and export, beside the Leads list's main actions.
// Import maps a CSV's columns to lead fields, checks every row on the server first (a dry run: what
// would be created, what is a possible duplicate, what is invalid and why), then creates only the
// valid new leads on purpose. It never updates a lead: a row whose email or phone matches a lead
// of the firm (or an earlier row) is skipped and listed, for Review Duplicates. Export states its
// scope (selected leads, the filtered list, or all the member reaches) and fields before the file
// is made; private fields (date of birth, address) are never in it.

const DateTime = z.iso.datetime({ offset: true });

/** The lead fields a column can be mapped to (first name, last name and email are required). */
export const LEAD_IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'businessName',
  'source',
  'sourceDetail',
  'priority',
  'service',
] as const;
export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];
export const LEAD_IMPORT_FIELD_LABELS: Record<LeadImportField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  businessName: 'Business name',
  source: 'Lead source',
  sourceDetail: 'Source details',
  priority: 'Priority',
  service: 'Service',
};
/** At most this many rows per import. */
export const LEAD_IMPORT_MAX_ROWS = 500;

/** One mapped row, as text from the file (the server reads and checks each value). */
const ImportRow = z.partialRecord(z.enum(LEAD_IMPORT_FIELDS), z.string().max(1000));

/**
 * POST /business/leads/import (Leads CREATE): `dryRun` checks every row and creates nothing;
 * without it, only the rows that check out as new leads are created (each as Add New Lead makes
 * one, so the firm's assignment rules apply). `defaultServiceId` is the service of a row with none.
 * `duplicates`: SKIP (the default) leaves out a row that may duplicate a lead; REVIEW adds it too,
 * so the pair is compared (and merged, or marked not a duplicate) in Review Duplicates.
 */
export const ImportLeadsRequest = z.strictObject({
  rows: z
    .array(ImportRow)
    .min(1, 'The file has no rows')
    .max(LEAD_IMPORT_MAX_ROWS, `Import at most ${LEAD_IMPORT_MAX_ROWS} rows at a time`),
  defaultServiceId: z.uuid(),
  dryRun: z.boolean(),
  duplicates: z.enum(['SKIP', 'REVIEW']).default('SKIP'),
});
export type ImportLeadsRequest = z.input<typeof ImportLeadsRequest>;

/** What happens to one row: created (or would be), a possible duplicate (skipped), or invalid. */
export const LeadImportRowResult = z.object({
  /** 1 for the file's first data row. */
  row: z.number().int().positive(),
  status: z.enum(['CREATE', 'DUPLICATE', 'INVALID']),
  /** Why it is invalid: "Email: Enter a valid email address". */
  issues: z.array(z.string()),
  /** The lead it may duplicate (an earlier row of the file has none). */
  duplicateOf: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The lead made from it (not on a dry run; a DUPLICATE row only when added for review). */
  leadId: z.uuid().nullable(),
});
export type LeadImportRowResult = z.infer<typeof LeadImportRowResult>;

export const LeadImportResult = z.object({
  dryRun: z.boolean(),
  /** Leads made, with any possible duplicates added for review. */
  created: z.number().int(),
  duplicates: z.number().int(),
  invalid: z.number().int(),
  rows: z.array(LeadImportRowResult),
});
export type LeadImportResult = z.infer<typeof LeadImportResult>;

/** The columns an export can hold, in this order. */
export const LEAD_EXPORT_FIELDS = [
  'number',
  'name',
  'businessName',
  'email',
  'phone',
  'source',
  'campaign',
  'services',
  'priority',
  'stage',
  'assignedTo',
  'nextAction',
  'lastContact',
  'tags',
  'createdAt',
] as const;
export type LeadExportField = (typeof LEAD_EXPORT_FIELDS)[number];
export const LEAD_EXPORT_FIELD_LABELS: Record<LeadExportField, string> = {
  number: 'Lead number',
  name: 'Name',
  businessName: 'Business name',
  email: 'Email',
  phone: 'Phone',
  source: 'Source',
  campaign: 'Campaign',
  services: 'Services',
  priority: 'Priority',
  stage: 'Status',
  assignedTo: 'Assigned to',
  nextAction: 'Next action',
  lastContact: 'Last contact',
  tags: 'Tags',
  createdAt: 'Date added',
};

/**
 * POST /business/leads/export (the Owner, or anyone whose grid grants Leads EXPORT): a CSV of the
 * SELECTED leads (`ids`), the FILTERED list (`filters`, as the list), or ALL the leads the member
 * reaches, with the chosen `fields`; at most 5,000 rows. Audited with the scope and count.
 */
export const ExportLeadsRequest = z
  .strictObject({
    scope: z.enum(['SELECTED', 'FILTERED', 'ALL']),
    ids: z.array(z.uuid()).min(1).max(100).optional(),
    filters: LeadPipelineQuery.omit({ page: true, pageSize: true }).partial().optional(),
    fields: z.array(z.enum(LEAD_EXPORT_FIELDS)).min(1, 'Choose at least one column'),
  })
  .refine((b) => b.scope !== 'SELECTED' || (b.ids?.length ?? 0) > 0, {
    message: 'Select the leads to export',
    path: ['ids'],
  });
export type ExportLeadsRequest = z.input<typeof ExportLeadsRequest>;

/** A short-lived link to the CSV (five minutes), and how many leads it holds. */
export const LeadExportLink = z.object({
  url: z.string(),
  expiresAt: DateTime,
  fileName: z.string(),
  rowCount: z.number().int(),
});
export type LeadExportLink = z.infer<typeof LeadExportLink>;

/** `api.leadTransfer`: import and export. */
export function createLeadTransferClient(request: ApiRequest) {
  return {
    import: async (body: ImportLeadsRequest): Promise<LeadImportResult> =>
      request(LeadImportResult, '/business/leads/import', {
        method: 'POST',
        body: parseInput(ImportLeadsRequest, body),
      }),
    export: async (body: ExportLeadsRequest): Promise<LeadExportLink> =>
      request(LeadExportLink, '/business/leads/export', {
        method: 'POST',
        body: parseInput(ExportLeadsRequest, body),
      }),
  };
}
export type LeadTransferClient = ReturnType<typeof createLeadTransferClient>;

/** Which import field a CSV header most likely means ("E-mail" is email), or null. */
export function guessImportField(header: string): LeadImportField | null {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  const table: [LeadImportField, string[]][] = [
    ['firstName', ['firstname', 'first', 'givenname', 'fname']],
    ['lastName', ['lastname', 'last', 'surname', 'familyname', 'lname']],
    ['email', ['email', 'emailaddress', 'mail']],
    ['phone', ['phone', 'phonenumber', 'mobile', 'cell', 'telephone']],
    ['businessName', ['businessname', 'business', 'company', 'companyname']],
    ['source', ['source', 'leadsource']],
    ['sourceDetail', ['sourcedetail', 'sourcedetails', 'campaign']],
    ['priority', ['priority']],
    ['service', ['service', 'services', 'serviceinterestedin']],
  ];
  return table.find(([, names]) => names.includes(h))?.[0] ?? null;
}

/**
 * The rows of a CSV file (RFC 4180: quoted fields, doubled quotes, commas and line breaks inside
 * quotes), the first being the header. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}
