import type { EsignRecipientRecord, EsignRequestRecord } from '../requests/esign.repository.js';

// The portal's Signature center storage (R13): a signed-in client login's own recipients. Like
// the other esign ports, every method takes the firm first and the Prisma implementation (with
// r0_esign) uses only forBusiness(businessId). Until then the API has notMigrated() and tests use
// InMemoryCenterRepository (test/unit/esign-fakes.ts).

/** One of the login's recipients, with its request. */
export interface MySignatureRecord {
  request: EsignRequestRecord;
  recipient: EsignRecipientRecord;
}

export interface EsignCenterRepository {
  /**
   * The SIGNER and CC recipients linked to this client login (link CLIENT_LOGIN with this
   * `clientAccountId`; never the household's other logins) on requests that were sent
   * (sent_at set: never a DRAFT or one awaiting approval), newest sent first.
   */
  mine(businessId: string, clientAccountId: string): Promise<MySignatureRecord[]>;
  /** One of `mine` by recipient id; null for any other (another login's, firm's, a draft's). */
  one(
    businessId: string,
    clientAccountId: string,
    recipientId: string,
  ): Promise<MySignatureRecord | null>;
}

export const CENTER_REPOSITORY = Symbol('ESIGN_CENTER_REPOSITORY');
