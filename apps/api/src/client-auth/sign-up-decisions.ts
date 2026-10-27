// What both sides of Client Sign-ups share (Octavia's spec of Oct 25): which client records a
// waiting sign-up may belong to, the operation record that makes each write safe to retry, and
// the firm's Automatic Approval rule. The firm's queue (client-sign-ups.service.ts) and the
// portal's sign-up (sign-up.service.ts) both use them, so the rule is one rule.
import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma, type SignupOperationKind, type TxClient } from '@firmivra/db';
import { createClientFromSignUp, lockClientEmails } from './client-records.js';

export const staleVersion = () =>
  new ConflictException({
    code: 'STALE_VERSION',
    message: 'This changed since you opened it. Read it again before you decide.',
  });
const keyReused = () =>
  new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'This request key was already used for something else. Nothing changed.',
  });

/** A client record of the firm a waiting sign-up may belong to, and what matched. */
export interface SignUpCandidate {
  accountId: string;
  clientId: string;
  clientNumber: number;
  displayName: string;
  byEmail: boolean;
  byPhone: boolean;
  /** OPEN until a member resolves it (client_signup_match_candidates). */
  resolution: 'OPEN' | 'NOT_A_MATCH' | 'VERIFIED';
}

/**
 * Whether a candidate still holds the request back: every email match does (one email, one
 * client), and a phone match until a member resolved it as not this person (Octavia's D2, F12).
 */
export const holdsBack = (c: SignUpCandidate) => c.byEmail || c.resolution !== 'NOT_A_MATCH';

/** A phone's last 10 digits: "+1 (770) 555-0123" and "7705550123" are the same number. */
const tenDigits = (column: Prisma.Sql) =>
  Prisma.sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10)`;

/**
 * The firm's client records (archived ones too) that sign-ups may belong to: the same email (both
 * lower-cased) or the same phone's last 10 digits. A name alone never counts. One request whatever
 * its state (approve checks it after claiming it), or every waiting one. Runs in the firm's scope.
 */
export function signUpCandidates(tx: TxClient, accountId?: string): Promise<SignUpCandidate[]> {
  const which = accountId
    ? Prisma.sql`a.id = ${accountId}::uuid`
    : Prisma.sql`a.status = 'PENDING_APPROVAL'`;
  const phone = Prisma.sql`(length(${tenDigits(Prisma.sql`u.phone`)}) = 10
    AND ${tenDigits(Prisma.sql`c.phone`)} = ${tenDigits(Prisma.sql`u.phone`)})`;
  return tx.$queryRaw<SignUpCandidate[]>`
    SELECT a.id::text AS "accountId", c.id::text AS "clientId", c.client_number AS "clientNumber",
      c.display_name AS "displayName",
      coalesce(lower(c.email) = lower(a.email), false) AS "byEmail", ${phone} AS "byPhone",
      coalesce(m.resolution::text, 'OPEN') AS resolution
    FROM client_accounts a
    JOIN users u ON u.id = a.user_id
    JOIN clients c ON c.business_id = a.business_id
      AND (lower(c.email) = lower(a.email) OR ${phone})
    LEFT JOIN client_signup_match_candidates m ON m.business_id = a.business_id
      AND m.client_account_id = a.id AND m.candidate_client_id = c.id
    WHERE ${which}
    ORDER BY a.id, c.client_number`;
}

/** The SHA-256 of a write's meaning, so a key reused with other data is refused. */
export const requestHash = (payload: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/**
 * The outcome an earlier attempt with this key committed, or null. The same key with other data
 * is 409 IDEMPOTENCY_KEY_REUSED: the earlier operation stands.
 */
export async function priorOutcome<T>(
  tx: TxClient,
  businessId: string,
  idempotencyKey: string,
  hash: string,
): Promise<T | null> {
  const op = await tx.clientSignupOperation.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
    select: { requestHash: true, result: true },
  });
  if (!op) return null;
  if (op.requestHash !== hash) throw keyReused();
  return op.result as T;
}

/** Records a committed write with its outcome, in the write's own transaction. */
export async function recordOperation(
  tx: TxClient,
  op: {
    businessId: string;
    clientAccountId: string | null;
    kind: SignupOperationKind;
    idempotencyKey: string;
    hash: string;
    result: Record<string, unknown>;
    correlationId: string;
    actorUserId: string | null;
  },
): Promise<void> {
  await tx.clientSignupOperation.create({
    data: {
      businessId: op.businessId,
      clientAccountId: op.clientAccountId,
      kind: op.kind,
      idempotencyKey: op.idempotencyKey,
      requestHash: op.hash,
      status: 'COMMITTED',
      result: op.result as Prisma.InputJsonObject,
      correlationId: op.correlationId,
      actorUserId: op.actorUserId,
    },
  });
}

/** What Automatic Approval did with a completed sign-up. */
export type AutomaticDecision =
  | { approved: true; clientId: string; policyVersion: number; correlationId: string }
  | { approved: false };

/**
 * The firm's Automatic Approval rule (Rasel's defaults of Oct 25): the firm is in Automatic mode,
 * the sign-up is complete and waiting, and no client record of the firm may be this person (no
 * email or phone match). Then, in one transaction under the firm's policy row, the sign-up is
 * approved with a new client record and the policy version it used; anything else leaves it
 * waiting for the firm, a match flagged. A mode change at the same moment waits for this.
 */
export async function approveAutomatically(
  tx: TxClient,
  businessId: string,
  clientAccountId: string,
): Promise<AutomaticDecision> {
  const [policy] = await tx.$queryRaw<{ mode: string; version: number }[]>`
    SELECT client_signup_mode::text AS mode, client_signup_policy_version AS version
    FROM business_settings WHERE business_id = ${businessId}::uuid FOR SHARE`;
  if (!policy || policy.mode !== 'AUTOMATIC') return { approved: false };
  const account = await tx.clientAccount.findUnique({
    where: { id: clientAccountId },
    select: {
      id: true,
      status: true,
      clientId: true,
      version: true,
      email: true,
      accountType: true,
      user: { select: { name: true, phone: true } },
    },
  });
  if (!account || account.status !== 'PENDING_APPROVAL' || account.clientId) {
    return { approved: false };
  }
  // A client created or changed at the same time waits, so the match check stays true.
  await lockClientEmails(tx, businessId);
  const now = new Date();
  if ((await signUpCandidates(tx, account.id)).some(holdsBack)) {
    await tx.clientAccount.update({
      where: { id: account.id },
      data: { matchStatus: 'POTENTIAL_MATCH', matchCheckedAt: now },
    });
    return { approved: false };
  }
  const claimed = await tx.clientAccount.updateMany({
    where: { id: account.id, status: 'PENDING_APPROVAL', version: account.version },
    data: {
      status: 'ACTIVE',
      approvedAt: now,
      approvedByUserId: null,
      decidedAutomatically: true,
      decisionPolicyVersion: policy.version,
      matchStatus: 'NO_MATCH',
      matchCheckedAt: now,
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return { approved: false };
  const clientId = await createClientFromSignUp(tx, businessId, {
    name: account.user.name,
    email: account.email,
    phone: account.user.phone,
    accountType: account.accountType,
  });
  await tx.clientAccount.update({
    where: { id: account.id },
    data: { clientId, portalRole: 'PRIMARY' },
  });
  const correlationId = randomUUID();
  const payload = { kind: 'APPROVE', clientAccountId: account.id, automatic: true };
  await recordOperation(tx, {
    businessId,
    clientAccountId: account.id,
    kind: 'APPROVE',
    // One automatic decision per sign-up, ever.
    idempotencyKey: `automatic:${account.id}`,
    hash: requestHash(payload),
    result: {
      clientAccountId: account.id,
      clientId,
      status: 'ACTIVE',
      approvedAt: now.toISOString(),
      version: account.version + 1,
      correlationId,
    },
    correlationId,
    actorUserId: null,
  });
  return { approved: true, clientId, policyVersion: policy.version, correlationId };
}
