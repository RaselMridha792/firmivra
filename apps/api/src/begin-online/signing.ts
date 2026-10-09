import { ServiceUnavailableException, type Provider } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { SubmitDraftRequest } from '@firmivra/types';
import type { SignedBy } from '../intake/intake-submit.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

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
 * Until R14's sign() lands: in development and test it writes no intake_signatures row and only
 * answers the printed name, now and where the request came from; elsewhere it refuses every
 * submit (503 SIGNING_UNAVAILABLE), so no lead is sent without its agreements.
 */
export const PLACEHOLDER_SIGNING: Provider = {
  provide: INTAKE_SIGNING,
  inject: [ENV],
  useFactory: (env: Env): IntakeSigner => ({
    sign: (_tx, _ids, signature) => {
      if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
        const { printedName: name, ip, userAgent } = signature;
        return Promise.resolve({ name, signedAt: new Date(), ip, userAgent });
      }
      return Promise.reject(
        new ServiceUnavailableException({
          code: 'SIGNING_UNAVAILABLE',
          message: 'Signing is not available right now. Please try again later.',
        }),
      );
    },
  }),
};
