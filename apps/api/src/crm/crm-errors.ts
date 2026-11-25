import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { databaseErrorCode } from '@firmivra/db';
import type { CrmErrorCode } from '@firmivra/types';

const MESSAGES: Readonly<Record<CrmErrorCode, string>> = {
  NOT_FOUND: 'Not found',
  VALIDATION_FAILED: 'The request is not valid',
  NO_CONSENT: 'This contact has not agreed to be contacted',
  SUPPRESSED: 'This contact is suppressed and gets no messages',
  ALREADY_ENROLLED: 'This contact is already on this journey',
  JOURNEY_NOT_ACTIVE: 'This journey is not active',
  JOURNEY_ARCHIVED: 'This journey is archived',
  NO_PUBLISHED_VERSION: 'Publish a version of this journey first',
  DRAFT_EXISTS: 'This journey already has a draft version',
  VERSION_PUBLISHED: 'A published version cannot change',
  EMPTY_JOURNEY: 'Add at least one step before publishing',
  TEMPLATE_NOT_USABLE: 'Choose an active email template',
  ENROLLMENT_CLOSED: 'This enrollment has already ended',
  DEMO_CLOSED: 'This demo request is closed',
  OPPORTUNITY_MISMATCH: 'This opportunity belongs to another contact',
};

const STATUS: Readonly<Record<CrmErrorCode, 400 | 404 | 409 | 422>> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  NO_CONSENT: 422,
  SUPPRESSED: 422,
  ALREADY_ENROLLED: 409,
  JOURNEY_NOT_ACTIVE: 422,
  JOURNEY_ARCHIVED: 409,
  NO_PUBLISHED_VERSION: 422,
  DRAFT_EXISTS: 409,
  VERSION_PUBLISHED: 409,
  EMPTY_JOURNEY: 422,
  TEMPLATE_NOT_USABLE: 422,
  ENROLLMENT_CLOSED: 409,
  DEMO_CLOSED: 409,
  OPPORTUNITY_MISMATCH: 422,
};

/** A contract error with its status and message. */
export function refuse(code: CrmErrorCode, message = MESSAGES[code]) {
  const body = { code, message };
  switch (STATUS[code]) {
    case 400:
      return new BadRequestException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    default:
      return new UnprocessableEntityException(body);
  }
}

export const notFound = (what: string) => refuse('NOT_FOUND', `${what} not found`);

/**
 * A backstop for a database refusal the checks before it missed (two saves at once): a unique
 * index as `unique`, the published-version rule as VERSION_PUBLISHED. Anything else is
 * rethrown as it was, so a real fault stays a 500 and is never dressed up as "not found".
 */
export function asCrmError(error: unknown, unique: CrmErrorCode = 'VALIDATION_FAILED'): unknown {
  const sqlState = databaseErrorCode(error);
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2002' || sqlState === '23505') return refuse(unique);
  if (sqlState === '23514') {
    const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
      ?.driverAdapterError?.cause as { originalMessage?: unknown; message?: unknown } | undefined;
    const message = String(cause?.originalMessage ?? cause?.message ?? '');
    if (message.includes('published journey version')) return refuse('VERSION_PUBLISHED');
    return refuse('VALIDATION_FAILED', 'The database refused this change');
  }
  return error;
}
