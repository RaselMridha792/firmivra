import type { Provider } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { IntakeSignatureInput } from '@firmivra/types';
import type { z } from 'zod';
import { IntakeSignaturesService } from '../agreements/intake-signatures.service.js';
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
 * INTAKE_SIGNING is R14's IntakeSignaturesService.sign(tx, input): it checks the signature
 * against the firm's current agreement block (and, for a lead, the Terms and Privacy), writes the
 * intake_signatures row the database needs for a submitted version, and maps the database's
 * intake_signatures_typed_matches check (SQLSTATE 23514) to 400 SIGNATURE_MISMATCH. It reads the
 * IP and user agent from the request context, the same values as `ip` and `userAgent`.
 */
export const INTAKE_SIGNING_PROVIDER: Provider = {
  provide: INTAKE_SIGNING,
  inject: [IntakeSignaturesService],
  useFactory: (signatures: IntakeSignaturesService): IntakeSigner => ({
    async sign(tx, input) {
      const signed = await signatures.sign(tx, input);
      return {
        name: signed.printedName,
        signedAt: signed.signedAt,
        ip: signed.ip,
        userAgent: signed.userAgent,
      };
    },
  }),
};

/** R14's mapping of the database's name check, for a signer that isn't R14's (tests). */
export { signingRefusal } from '../agreements/intake-signatures.service.js';
