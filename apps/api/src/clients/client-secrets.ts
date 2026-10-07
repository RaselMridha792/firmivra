import { HttpException, HttpStatus } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type FieldContext,
  type FieldEncryption,
  FieldEncryptionError,
} from '../field-encryption/field-encryption.service.js';

/** The client's SSN, EIN and date of birth live in client_profiles, encrypted per field. */
const TABLE = 'client_profiles';

const context = (businessId: string, clientId: string, field: string): FieldContext => ({
  businessId,
  table: TABLE,
  recordId: clientId,
  field,
});

/** What a request may send for them: a value to store, `null` to clear, left out to keep. */
export interface SecretInput {
  ssn?: string | null | undefined;
  ein?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
}

/**
 * 503 when the helper can't work right now (the firm has no key yet, KMS is down or refuses the
 * key). Never with a value or an AWS detail; anything else is a bug and stays a 500.
 */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof FieldEncryptionError &&
      ['KEY_NOT_PROVISIONED', 'KMS_UNAVAILABLE', 'KEY_ACCESS_DENIED'].includes(error.code)
    ) {
      throw new HttpException(
        {
          code: 'ENCRYPTION_UNAVAILABLE',
          message:
            'SSN, EIN and date of birth cannot be saved or shown right now. Try again later.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw error;
  }
}

/**
 * The profile's encrypted columns for what the request sent: each value through the
 * field-encryption helper (the firm's key, bound to this client and field), the SSN and EIN with
 * their last 4 digits (the only part ever returned). The contract already normalised them.
 * `tx` is the caller's write transaction: in AWS mode the firm's key id is read in it.
 */
export async function secretColumns(
  fe: FieldEncryption,
  tx: TxClient,
  businessId: string,
  clientId: string,
  body: SecretInput,
): Promise<Prisma.ClientProfileUncheckedUpdateInput> {
  return guarded(async () => {
    const data: Prisma.ClientProfileUncheckedUpdateInput = {};
    const seal = (field: string, value: string) =>
      fe.encrypt(context(businessId, clientId, field), value, { tx });
    if (body.ssn !== undefined) {
      data.ssnEnc = body.ssn === null ? null : await seal('ssn', body.ssn);
      data.ssnLast4 = body.ssn === null ? null : body.ssn.slice(-4);
    }
    if (body.ein !== undefined) {
      data.einEnc = body.ein === null ? null : await seal('ein', body.ein);
      data.einLast4 = body.ein === null ? null : body.ein.slice(-4);
    }
    if (body.dateOfBirth !== undefined) {
      data.dobEnc =
        body.dateOfBirth === null ? null : await seal('date_of_birth', body.dateOfBirth);
    }
    return data;
  });
}

/** The date of birth in full (`YYYY-MM-DD`), for the firm's staff and the primary login only. */
export async function readDateOfBirth(
  fe: FieldEncryption,
  businessId: string,
  clientId: string,
  dobEnc: Uint8Array | null | undefined,
): Promise<string | null> {
  if (!dobEnc) return null;
  return guarded(() => fe.decrypt(context(businessId, clientId, 'date_of_birth'), dobEnc));
}

/** The names of the fields a request changed, for the audit log (never their values). */
export const changedFields = (body: object): string[] =>
  Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
