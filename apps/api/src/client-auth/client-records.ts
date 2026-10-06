import type { TxClient } from '@firmivra/db';
import type { AccountType } from '@firmivra/types';

/** What a new client record is made from: the approved portal sign-up. */
export interface SignUpDetails {
  name: string;
  email: string;
  phone: string | null;
  accountType: AccountType;
}

/**
 * The firm's client record for an approved portal sign-up: display name, email, phone and account
 * type, nothing else. Client records belong to R10; this one small insert is R3's until R10's
 * service takes it over (docs/work/R3-client-auth.md, Needs from others).
 */
export async function createClientFromSignUp(
  tx: TxClient,
  businessId: string,
  signUp: SignUpDetails,
): Promise<string> {
  const client = await tx.client.create({
    data: {
      businessId,
      displayName: signUp.name,
      email: signUp.email,
      phone: signUp.phone,
      accountType: signUp.accountType,
    },
    select: { id: true },
  });
  return client.id;
}

/**
 * Whether approve may link a sign-up's login to an existing client record (#37, client-auth.yaml
 * "Linking an existing client record"): the record's email is the sign-up's verified email, both
 * lower-cased, and the record has no primary portal login yet. That login would see the record's
 * tax files, so nothing looser ever passes. `existingClient` in the queue uses the same rule.
 */
export function linkable(
  verifiedEmail: string,
  record: { email: string | null; primaryLogins: number },
): boolean {
  return (
    record.primaryLogins === 0 &&
    record.email !== null &&
    record.email.toLowerCase() === verifiedEmail.toLowerCase()
  );
}

/** Counts a record's primary portal logins (any status) in a Prisma select. */
export const PRIMARY_LOGINS = {
  _count: { select: { accounts: { where: { portalRole: 'PRIMARY' as const } } } },
};
