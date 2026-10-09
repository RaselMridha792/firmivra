import type { Database } from '@firmivra/db';
import type { ClientAccountStatus } from '@firmivra/types';

/**
 * Who may sign in to a firm's portal: an ACTIVE client of that firm, or one waiting for the firm
 * whose sign-up is complete: email verified, and the phone verified or (SMS fallback,
 * SIGNUP_PHONE_VERIFICATION=optional) the legal acceptances written when it completed (they see
 * only the "waiting" page, client-auth.yaml).
 * Unfinished sign-ups, declined, disabled and invited accounts cannot, and get the same answer
 * as a wrong password.
 */
const maySignIn = (a: {
  status: ClientAccountStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  legalAcceptances: { id: string }[];
}) =>
  a.status === 'ACTIVE' ||
  (a.status === 'PENDING_APPROVAL' &&
    a.emailVerifiedAt !== null &&
    (a.phoneVerifiedAt !== null || a.legalAcceptances.length > 0));

export interface PortalClient {
  userId: string;
  cognitoSub: string;
  clientAccountId: string;
  status: ClientAccountStatus;
}

/** The firm's client who may sign in, by email (sign-in) or by user (refresh, `GET me`). */
export async function portalClient(
  db: Database,
  businessId: string,
  by: { email: string } | { userId: string },
): Promise<PortalClient | undefined> {
  const account = await db.forBusiness(businessId).clientAccount.findUnique({
    where:
      'email' in by
        ? { businessId_email: { businessId, email: by.email } }
        : { businessId_userId: { businessId, userId: by.userId } },
    select: {
      id: true,
      status: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      legalAcceptances: { select: { id: true }, take: 1 },
      user: { select: { id: true, cognitoSub: true } },
    },
  });
  if (!account || !maySignIn(account)) return undefined;
  return {
    userId: account.user.id,
    cognitoSub: account.user.cognitoSub,
    clientAccountId: account.id,
    status: account.status,
  };
}
