import { BadRequestException, type Provider, ServiceUnavailableException } from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import { INTAKE_SIGNING_ERRORS, type IntakeSignatureInput } from '@firmivra/types';
import type { z } from 'zod';
import type { SignedBy } from './intake-submit.js';

/**
 * What a submit asks the signer to sign, in the submit's transaction, after the final answers
 * are saved on the draft: R14's IntakeSignaturesService.sign(tx, input) input. The portal's
 * signer is the signed-in client's login (the transaction runs with that login's actorUserId);
 * Begin Online's is the lead.
 */
export interface IntakeSignInput {
  businessId: string;
  intakeId: string;
  /** The draft version being submitted. */
  submissionId: string;
  /** The intake's service (services.id), whose agreements are signed with the firm-wide one. */
  serviceId: string | null;
  signer:
    | { kind: 'client'; clientAccountId: string }
    | { kind: 'lead'; leadId: string; email: string | null };
  signature: z.output<typeof IntakeSignatureInput>;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Signs the firm's intake agreements for the version being submitted and answers the evidence
 * the version stores next to submitted_at; throws to refuse the submit (INTAKE_SIGNING_ERRORS).
 * Both submits (portal intake and Begin Online) take it from INTAKE_SIGNING.
 */
export interface IntakeSigner {
  sign(tx: TxClient, input: IntakeSignInput): Promise<SignedBy>;
}

export const INTAKE_SIGNING = Symbol('INTAKE_SIGNING');

/**
 * Until R14's sign() is wired it refuses every submit (503 SIGNING_UNAVAILABLE): the database
 * rejects a submitted version without its intake_signatures row, so going on without writing it
 * would only turn into a 500. Nothing is sent without its agreements.
 */
export const PLACEHOLDER_SIGNING: Provider = {
  provide: INTAKE_SIGNING,
  useFactory: (): IntakeSigner => ({
    sign: () =>
      Promise.reject(
        new ServiceUnavailableException({
          code: 'SIGNING_UNAVAILABLE',
          message: 'Signing is not available right now. Please try again later.',
        }),
      ),
  }),
};

/**
 * The database's refusal of a signature row as the contract's answer, or undefined: the
 * intake_signatures_typed_matches check (SQLSTATE 23514) compares the two names with Postgres'
 * own folding, which can differ from the API's, so it is 400 SIGNATURE_MISMATCH, never a 500.
 */
export function signingRefusal(error: unknown): BadRequestException | undefined {
  if (databaseErrorCode(error) !== '23514') return undefined;
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { originalMessage?: unknown; constraint?: unknown } | undefined;
  const text = [cause?.originalMessage, cause?.constraint, (error as Error | null)?.message]
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
  if (!text.includes('intake_signatures_typed_matches')) return undefined;
  return new BadRequestException({
    code: 'SIGNATURE_MISMATCH',
    message: INTAKE_SIGNING_ERRORS.SIGNATURE_MISMATCH,
  });
}
