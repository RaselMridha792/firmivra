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
 * The key R10's client records use to change a firm's client emails one at a time
 * (`clients_email:{businessId}`, clients.service.ts). Exported so both take the same lock.
 */
export const clientsEmailLockKey = (businessId: string) => `clients_email:${businessId}`;

/**
 * Takes the firm's client-email lock for the rest of the transaction: any other check-then-write
 * of a client email at this firm (R10's create and update, approve here) waits for it.
 */
export async function lockClientEmails(tx: TxClient, businessId: string): Promise<void> {
  const key = clientsEmailLockKey(businessId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * The firm's client record for an approved portal sign-up: display name, email, phone and account
 * type, and an empty profile row, as R10's create makes. Client records belong to R10; this one
 * small insert is R3's until R10's service takes it over (docs/work/R3-client-auth.md).
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
  await tx.clientProfile.create({ data: { businessId, clientId: client.id } });
  return client.id;
}

/**
 * Whether approve may link a sign-up's login to an existing client record (#37, client-auth.yaml
 * "Linking an existing client record"): the record's email is the sign-up's verified email, both
 * lower-cased, the record has no primary portal login yet, and it is not archived (restore it
 * first, as for tax years). That login would see the record's tax files, so nothing looser ever
 * passes. `existingClient` in the queue uses the same rule.
 */
export function linkable(
  verifiedEmail: string,
  record: { email: string | null; primaryLogins: number; archivedAt: Date | null },
): boolean {
  return (
    record.primaryLogins === 0 &&
    record.archivedAt === null &&
    record.email !== null &&
    record.email.toLowerCase() === verifiedEmail.toLowerCase()
  );
}

/** Counts a record's primary portal logins (any status) in a Prisma select. */
export const PRIMARY_LOGINS = {
  _count: { select: { accounts: { where: { portalRole: 'PRIMARY' as const } } } },
};
