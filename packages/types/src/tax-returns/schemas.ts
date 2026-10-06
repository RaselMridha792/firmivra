import { z } from 'zod';
import { CalendarDate } from '../clients/schemas.js';

// Tax returns (R10): one row per return on the portal's Taxes tab (mockup "Taxes tab"), annual or
// a quarterly estimate, with the status the client sees, the filed date and the return PDF.
// Firm routes: /api/v1/business/tax-returns and /business/clients/{id}/tax-returns
// (Owner, Admin, Staff). Portal: /api/v1/portal/{firmSlug}/me/tax-returns (the client's own).
// The PDF is one of the client's own documents, never an internal one; View and Download go
// through the documents API with `document.id`.

const DateTime = z.iso.datetime({ offset: true });

export const TaxReturnId = z.uuid();
export const TaxFilingType = z.enum(['INDIVIDUAL', 'BUSINESS']);
export type TaxFilingType = z.infer<typeof TaxFilingType>;
export const TaxReturnStatus = z.enum([
  'IN_PROGRESS',
  'FILED',
  'ACCEPTED',
  'REJECTED',
  'COMPLETED',
]);
export type TaxReturnStatus = z.infer<typeof TaxReturnStatus>;

export const DocumentRef = z.strictObject({ id: z.uuid(), fileName: z.string() });
export type DocumentRef = z.infer<typeof DocumentRef>;

const year = z.number().int().min(2000).max(2100);
const quarter = z.number().int().min(1).max(4);
const formType = z.string().trim().min(1, 'Enter the form').max(20, 'Use at most 20 characters');

/** A return as the firm sees it. */
export const TaxReturn = z.strictObject({
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
export const TaxReturnList = z.strictObject({ items: z.array(TaxReturn) });

/**
 * POST /business/tax-returns. FILED and ACCEPTED need filedOn (not in the future). The engagement
 * and the PDF must be this client's; the PDF never an internal document.
 */
export const CreateTaxReturnRequest = z.strictObject({
  clientId: z.uuid(),
  taxYear: year,
  filingType: TaxFilingType,
  quarter: quarter.optional(),
  formType: formType.optional(),
  status: TaxReturnStatus.optional().default('IN_PROGRESS'),
  filedOn: CalendarDate.optional(),
  engagementId: z.uuid().optional(),
  documentId: z.uuid().optional(),
});
export type CreateTaxReturnRequest = z.input<typeof CreateTaxReturnRequest>;

/** PATCH /business/tax-returns/{id}. The client never changes; null clears a field. */
export const UpdateTaxReturnRequest = z
  .strictObject({
    taxYear: year.optional(),
    filingType: TaxFilingType.optional(),
    quarter: quarter.nullable().optional(),
    formType: formType.nullable().optional(),
    status: TaxReturnStatus.optional(),
    filedOn: CalendarDate.nullable().optional(),
    engagementId: z.uuid().nullable().optional(),
    documentId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');
export type UpdateTaxReturnRequest = z.input<typeof UpdateTaxReturnRequest>;

// ---------- The client's own returns (portal) ----------
/** What the client sees of a return. */
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
export const MyTaxReturnList = z.strictObject({ items: z.array(MyTaxReturn) });

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const TaxReturnErrorCode = z.enum([
  /** 409: the PDF is not one of this client's documents, or is internal. */
  'INVALID_DOCUMENT',
  /** 409: only an IN_PROGRESS return can be deleted. */
  'RETURN_LOCKED',
]);
export type TaxReturnErrorCode = z.infer<typeof TaxReturnErrorCode>;
