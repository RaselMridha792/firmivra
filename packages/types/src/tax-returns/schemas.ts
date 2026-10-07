import { z } from 'zod';
import { TaxFilingType, TaxReturnStatus } from '../db-enums.js';
import { CalendarDate } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';

// Tax returns (R10): one row per return on the portal's Taxes tab (mockup "Taxes tab"), annual or
// a quarterly estimate, with the status the client sees, the filed date and the return PDF.
// Firm routes: /api/v1/business/clients/{id}/tax-returns and /business/tax-returns/{id}. Owner
// and Admin see every client's; Staff only their own clients' (others are 404).
// Portal: /api/v1/portal/{firmSlug}/me/tax-returns (the client's own).
// The PDF is one of the client's own documents, never an internal one; View and Download go
// through the documents API with `document.id`. Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const TaxReturnId = z.uuid();
// TaxFilingType and TaxReturnStatus are the database enums, generated into db-enums.ts.

export const DocumentRef = z.object({ id: z.uuid(), fileName: z.string() });
export type DocumentRef = z.infer<typeof DocumentRef>;

const year = z.number().int().min(2000).max(2100);
const quarter = z.number().int().min(1).max(4);
const FiledOn = CalendarDate.refine(
  (d) => d <= new Date().toISOString().slice(0, 10),
  'The filed date cannot be in the future',
);
const needsFiledOn = (body: { status?: TaxReturnStatus; filedOn?: string | null }) =>
  !(body.status === 'FILED' || body.status === 'ACCEPTED') || !!body.filedOn;
const FILED_ON = { message: 'Enter the date it was filed', path: ['filedOn'] };

/** A return as the firm sees it. */
export const TaxReturn = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  engagementId: z.uuid().nullable(),
  taxYear: z.number().int(),
  filingType: TaxFilingType,
  /** 1 to 4 for a quarterly estimate; null for the annual return. */
  quarter: quarter.nullable(),
  /** e.g. "1040", "1120-S". */
  formType: z.string().nullable(),
  status: TaxReturnStatus,
  filedOn: CalendarDate.nullable(),
  document: DocumentRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type TaxReturn = z.infer<typeof TaxReturn>;

/** GET /business/clients/{id}/tax-returns: newest year first. */
export const TaxReturnList = z.object({ items: z.array(TaxReturn) });

/**
 * POST /business/clients/{id}/tax-returns. FILED and ACCEPTED need filedOn (not in the future).
 * The engagement and the PDF must be this client's; the PDF never an internal document.
 */
export const CreateTaxReturnRequest = z
  .strictObject({
    taxYear: year,
    filingType: TaxFilingType,
    quarter: quarter.optional(),
    formType: text(20).optional(),
    status: TaxReturnStatus.optional().default('IN_PROGRESS'),
    filedOn: FiledOn.optional(),
    engagementId: z.uuid().optional(),
    documentId: z.uuid().optional(),
  })
  .refine(needsFiledOn, FILED_ON);
export type CreateTaxReturnRequest = z.input<typeof CreateTaxReturnRequest>;

/**
 * PATCH /business/tax-returns/{id}. The client never changes; `null` or `''` clears a field.
 * A return that was FILED, ACCEPTED or COMPLETED cannot go back to IN_PROGRESS (409
 * INVALID_STATUS); a REJECTED one can, to be fixed and filed again.
 */
export const UpdateTaxReturnRequest = z
  .strictObject({
    taxYear: year.optional(),
    filingType: TaxFilingType.optional(),
    quarter: quarter.nullable().optional(),
    formType: clearable(text(20)),
    status: TaxReturnStatus.optional(),
    filedOn: clearable(FiledOn),
    engagementId: z.uuid().nullable().optional(),
    documentId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), 'Change at least one field')
  .refine(
    (body) => !(body.status === 'FILED' || body.status === 'ACCEPTED') || body.filedOn !== null,
    FILED_ON,
  );
export type UpdateTaxReturnRequest = z.input<typeof UpdateTaxReturnRequest>;

// ---------- The client's own returns (portal) ----------
/**
 * What the client sees of a return. `document` is set only once the PDF has passed its virus
 * scan.
 */
export const MyTaxReturn = TaxReturn.pick({
  id: true,
  taxYear: true,
  filingType: true,
  quarter: true,
  formType: true,
  status: true,
  filedOn: true,
  document: true,
});
export type MyTaxReturn = z.infer<typeof MyTaxReturn>;

/**
 * GET /portal/{firmSlug}/me/tax-returns. The tab's filters: a tax year ("All Years" = none), and
 * the cards: Quarterly Taxes (kind=quarterly), Annual Personal (annual + INDIVIDUAL), Annual
 * Business (annual + BUSINESS).
 */
export const MyTaxReturnsQuery = z.strictObject({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  kind: z.enum(['annual', 'quarterly']).optional(),
  filingType: TaxFilingType.optional(),
});
export type MyTaxReturnsQuery = z.input<typeof MyTaxReturnsQuery>;

/** Newest year first; within a year, the annual return before the quarters. */
export const MyTaxReturnList = z.object({ items: z.array(MyTaxReturn) });

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const TaxReturnErrorCode = z.enum([
  /** 409: the PDF is not one of this client's documents, or is internal. */
  'INVALID_DOCUMENT',
  /** 409: a FILED, ACCEPTED or COMPLETED return cannot go back to IN_PROGRESS. */
  'INVALID_STATUS',
  /** 409: a return that was ever filed is never deleted. */
  'RETURN_LOCKED',
]);
export type TaxReturnErrorCode = z.infer<typeof TaxReturnErrorCode>;
