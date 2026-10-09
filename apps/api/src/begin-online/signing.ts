import { ServiceUnavailableException, type Provider } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { SubmitDraftRequest } from '@firmivra/types';
import type { SignedBy } from '../intake/intake-submit.js';

/** What a signature records besides the version: the names typed and where it came from. */
export interface DraftSignature {
  printedName: string;
  typedSignature: SubmitDraftRequest['typedSignature'];
  ip: string | null;
  userAgent: string | null;
}

/**
 * Signs the firm's intake agreements for the version being submitted, in the submit's
 * transaction, and answers who signed and when (the version stores the same); throws to refuse
 * the submit. R14's intake signing service (sign()) replaces the placeholder below: it inserts the
 * intake_signatures row the database requires for a submitted version.
 */
export interface IntakeSigner {
  sign(
    tx: TxClient,
    ids: { businessId: string; intakeId: string; submissionId: string; version: number },
    signature: DraftSignature,
  ): Promise<SignedBy>;
}

export const INTAKE_SIGNING = Symbol('INTAKE_SIGNING');

/**
 * Until R14's sign() lands it refuses every submit (503 SIGNING_UNAVAILABLE): since #155 the
 * database rejects a submitted version without its intake_signatures row, so answering a name
 * without writing that row would only turn into a 500. No lead is sent without its agreements.
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
