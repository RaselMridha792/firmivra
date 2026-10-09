import {
  BadRequestException,
  ConflictException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { DocumentRef, MyTaxReturn, TaxReturn, TaxReturnStatus } from '@firmivra/types';

// The tax returns API's rules and shapes (R10 step 7; contract in packages/types/src/tax-returns),
// free of Nest and Prisma state so the unit tests cover them. The database keeps the same rules
// (migrations r0_tax_returns and r0_tax_return_fixes); the API checks them first.

export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
export const clientArchived = () =>
  new ConflictException({ code: 'CLIENT_ARCHIVED', message: 'Restore the client first' });
export const invalidDocument = () =>
  new ConflictException({
    code: 'INVALID_DOCUMENT',
    message: "The return PDF must be one of this client's documents, not an internal one",
  });
export const infectedDocument = () =>
  new ConflictException({
    code: 'INVALID_DOCUMENT',
    message: 'This file failed the virus scan and cannot be the return PDF',
  });
export const invalidStatus = () =>
  new ConflictException({
    code: 'INVALID_STATUS',
    message: 'A filed return cannot go back to in progress',
  });
export const returnLocked = () =>
  new ConflictException({
    code: 'RETURN_LOCKED',
    message: 'A return that was filed is never deleted',
  });

/** 400 VALIDATION_FAILED for one field, in the shape ZodValidationPipe answers with. */
export const invalidField = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path, message }],
  });
export const filedOnMissing = () => invalidField('filedOn', 'Enter the date it was filed');
const filedOnInFuture = () => invalidField('filedOn', 'The filed date cannot be in the future');

/** The fields of a return the firm sets, with the filed date as YYYY-MM-DD. */
export interface ReturnFields {
  taxYear: number;
  filingType: TaxReturn['filingType'];
  quarter: number | null;
  formType: string | null;
  status: TaxReturnStatus;
  filedOn: string | null;
  engagementId: string | null;
  documentId: string | null;
}

const FIELDS = [
  'taxYear',
  'filingType',
  'quarter',
  'formType',
  'status',
  'filedOn',
  'engagementId',
  'documentId',
] as const satisfies readonly (keyof ReturnFields)[];

/** FILED and ACCEPTED returns say when they were filed (the database agrees). */
export const needsFiledOn = (status: TaxReturnStatus) =>
  status === 'FILED' || status === 'ACCEPTED';

/**
 * A FILED, ACCEPTED or COMPLETED return never goes back to IN_PROGRESS (409 INVALID_STATUS); a
 * REJECTED one can, to be fixed and filed again. Every other move is allowed.
 */
export const canMoveTo = (from: TaxReturnStatus, to: TaxReturnStatus) =>
  to !== 'IN_PROGRESS' || from === 'IN_PROGRESS' || from === 'REJECTED';

/**
 * Only a return that never left IN_PROGRESS can be deleted: the database stamps `first_filed_at`
 * the first time it does, and its delete rule refuses any other.
 */
export const canDelete = (row: { status: TaxReturnStatus; firstFiledAt: Date | null }) =>
  row.status === 'IN_PROGRESS' && row.firstFiledAt === null;

/** What a PATCH changes: the fields it sends with a value other than the current one. */
export function changesOf(
  current: ReturnFields,
  body: { [K in keyof ReturnFields]?: ReturnFields[K] | undefined },
): Partial<ReturnFields> {
  const changes: Partial<Record<keyof ReturnFields, unknown>> = {};
  for (const key of FIELDS) {
    const value = body[key];
    if (value !== undefined && value !== current[key]) changes[key] = value;
  }
  return changes as Partial<ReturnFields>;
}

/** A `date` column's value as YYYY-MM-DD (Prisma reads it as midnight UTC). */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** YYYY-MM-DD for a `date` column. */
export const dateColumn = (day: string) => new Date(`${day}T00:00:00.000Z`);

interface ReturnRow {
  id: string;
  clientId: string;
  engagementId: string | null;
  taxYear: number;
  filingType: TaxReturn['filingType'];
  quarter: number | null;
  formType: string | null;
  status: TaxReturnStatus;
  filedOn: Date | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  document: { id: string; fileName: string } | null;
}

/** A return as the firm sees it; the PDF whatever its scan state (the firm's own vault). */
export function toTaxReturn(row: ReturnRow): TaxReturn {
  return {
    id: row.id,
    clientId: row.clientId,
    engagementId: row.engagementId,
    taxYear: row.taxYear,
    filingType: row.filingType,
    quarter: row.quarter,
    formType: row.formType,
    status: row.status,
    filedOn: row.filedOn ? isoDate(row.filedOn) : null,
    document: row.document ? { id: row.document.id, fileName: row.document.fileName } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function fieldsOf(row: ReturnRow): ReturnFields {
  return {
    taxYear: row.taxYear,
    filingType: row.filingType,
    quarter: row.quarter,
    formType: row.formType,
    status: row.status,
    filedOn: row.filedOn ? isoDate(row.filedOn) : null,
    engagementId: row.engagementId,
    documentId: row.documentId,
  };
}

interface LinkedDocument {
  id: string;
  fileName: string;
  clientId: string;
  direction: string;
  scanStatus: string;
}

/**
 * The PDF as the client sees it: only their own document, never an internal one, and only once
 * its virus scan is CLEAN. The database already refuses another client's or an internal one.
 */
export function visibleDocument(doc: LinkedDocument | null, clientId: string): DocumentRef | null {
  if (!doc || doc.clientId !== clientId || doc.direction === 'INTERNAL') return null;
  return doc.scanStatus === 'CLEAN' ? { id: doc.id, fileName: doc.fileName } : null;
}

type MyReturnRow = Pick<
  ReturnRow,
  'id' | 'taxYear' | 'filingType' | 'quarter' | 'formType' | 'status' | 'filedOn'
> & { document: LinkedDocument | null };

/** A return as the client sees it (portal): no client, engagement or internal ids. */
export function toMyTaxReturn(row: MyReturnRow, clientId: string): MyTaxReturn {
  return {
    id: row.id,
    taxYear: row.taxYear,
    filingType: row.filingType,
    quarter: row.quarter,
    formType: row.formType,
    status: row.status,
    filedOn: row.filedOn ? isoDate(row.filedOn) : null,
    document: visibleDocument(row.document, clientId),
  };
}

/** The table's CHECK constraints, by name: the request field each guards. */
const CHECKS: Record<string, [path: string, message: string]> = {
  tax_returns_filed_on: ['filedOn', 'Enter the date it was filed'],
  tax_returns_tax_year: ['taxYear', 'Enter a year from 2000 to 2100'],
  tax_returns_quarter: ['quarter', 'Enter a quarter from 1 to 4'],
  tax_returns_form_type: ['formType', 'Use at most 20 characters'],
};

/** The SQLSTATE and message behind a Prisma error from the pg adapter (see databaseErrorCode). */
function causeOf(error: unknown): { code?: string; message: string } {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { originalCode?: unknown; originalMessage?: unknown } | undefined;
  return {
    code: typeof cause?.originalCode === 'string' ? cause.originalCode : undefined,
    message: typeof cause?.originalMessage === 'string' ? cause.originalMessage : '',
  };
}

/**
 * The database's own refusal of a tax return write, as the answer the API's checks give, so a
 * rule the API missed is a 400, 404 or 409 and never a 500. Undefined: not such a refusal.
 * - foreign key (23503): the client, engagement or document is not there for this client: 404.
 * - the rules trigger (23514): another client's or an internal PDF: 409 INVALID_DOCUMENT; a filed
 *   date in the future: 400. A CHECK constraint (23514): 400 on its field.
 * A delete the database refuses removes nothing: the service answers RETURN_LOCKED for that.
 */
export function refusalOf(error: unknown): HttpException | undefined {
  const { code, message } = causeOf(error);
  if (code === '23503') return notFound();
  if (code !== '23514') return undefined;
  if (message.startsWith('tax returns: the return document')) return invalidDocument();
  if (message.startsWith('tax returns: filed_on cannot be in the future')) return filedOnInFuture();
  const check = CHECKS[/violates check constraint "([^"]+)"/.exec(message)?.[1] ?? ''];
  return check ? invalidField(...check) : undefined;
}
