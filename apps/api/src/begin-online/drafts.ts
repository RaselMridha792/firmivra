import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import {
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_SERVICES,
  beginOnlineFormOfPath,
  IntakeFormKey,
  type IntakeIssue,
} from '@firmivra/types';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/** A new resume-link token: 32 random bytes, base64url (43 characters). Only its SHA-256 is stored. */
export function newResumeToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The service of a page path (`annual-tax` is ANNUAL_TAX), or 404 NOT_FOUND. */
export function formOfPath(path: string): IntakeFormKey {
  const form = beginOnlineFormOfPath(path);
  if (!form) throw draftErrors.notFound();
  return form;
}

/**
 * The draft cookie of one service at one firm (contract B: HttpOnly, one per service, on
 * /api/v1/portal/{firmSlug}/begin, a few hours). crossSiteGuard counts `fv_bo_` cookies as
 * session cookies.
 */
export function beginOnlineCookie(firmSlug: string, form: IntakeFormKey) {
  const slug = firmSlug.toLowerCase();
  const page = BEGIN_ONLINE_SERVICES[form].path;
  return { name: `fv_bo_${slug}_${page}`, path: `/api/v1/portal/${slug}/begin` } as const;
}

/** How long a draft cookie lasts; the visitor's own activity sets it again. */
export const DRAFT_COOKIE_SECONDS = 6 * 60 * 60;

/** What the draft cookie binds: the firm, the lead and the form (its expiry is sealed in). */
const DraftClaim = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.uuid(),
  leadId: z.uuid(),
  form: IntakeFormKey,
});
export type DraftClaim = z.infer<typeof DraftClaim>;

type FirmRef = { id: string; slug: string };

/** The cookie's value: sealed by the API (JWE with an expiry), never a bare lead id. */
export class DraftCookies extends Sealer<DraftClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-begin-draft-v1', DraftClaim, secrets);
  }

  /** The claim of this browser's cookie for the service at this firm, or null. */
  async read(req: Request, firm: FirmRef, form: IntakeFormKey): Promise<DraftClaim | null> {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[
      beginOnlineCookie(firm.slug, form).name
    ];
    if (typeof value !== 'string' || value.length > 2048) return null;
    const claim = (await this.open(value, 'CLIENT'))?.value;
    return claim?.businessId === firm.id && claim.form === form ? claim : null;
  }

  /** Sets this browser's cookie for the service to the lead: a few hours, never past the draft. */
  async write(
    res: Response,
    firm: FirmRef,
    form: IntakeFormKey,
    leadId: string,
    draftExpiresAt: Date,
    secure: boolean,
  ): Promise<void> {
    const until = Math.min(Date.now() + DRAFT_COOKIE_SECONDS * 1000, draftExpiresAt.getTime());
    const value = await this.sealUntil(
      { pool: 'CLIENT', businessId: firm.id, leadId, form },
      Math.floor(until / 1000),
    );
    const { name, path } = beginOnlineCookie(firm.slug, form);
    res.cookie(name, value, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path,
      maxAge: Math.max(0, until - Date.now()),
    });
  }
}

/**
 * Renews a live draft in the database's clock and locks its row: the expiry becomes 30 days from
 * now, never past 90 days from its start (leads_draft_expiry, leads_draft_rules). Returns the new
 * expiry and update time, or null when the lead is no longer a live draft.
 */
export async function renewDraft(
  tx: TxClient,
  leadId: string,
): Promise<{ expiresAt: Date; updatedAt: Date } | null> {
  const rows = await tx.$queryRaw<{ draft_expires_at: Date; updated_at: Date }[]>`
    UPDATE leads
       SET draft_expires_at = e.at, updated_at = now()
      FROM (SELECT least(now() + interval '720 hours', l.created_at + interval '2160 hours') AS at
              FROM leads l WHERE l.id = ${leadId}::uuid) e
     WHERE id = ${leadId}::uuid AND status = 'DRAFT' AND draft_expires_at > now()
    RETURNING draft_expires_at, updated_at`;
  const row = rows[0];
  return row ? { expiresAt: row.draft_expires_at, updatedAt: row.updated_at } : null;
}

/** Why a lead that was found is not a live draft: 410 DRAFT_EXPIRED or 409 DRAFT_SUBMITTED. */
export function notLive(status: string): Error {
  return status === 'DRAFT' || status === 'EXPIRED'
    ? draftErrors.expired()
    : draftErrors.submitted();
}

/**
 * Locks the lead (FOR UPDATE: a parallel save, upload or submit of the draft waits) while it is
 * a live draft; else 410 DRAFT_EXPIRED, 409 DRAFT_SUBMITTED or 404.
 */
export async function holdDraft(tx: TxClient, leadId: string): Promise<{ email: string }> {
  const rows = await tx.$queryRaw<{ email: string; status: string; live: boolean }[]>`
    SELECT email, status::text AS status, coalesce(draft_expires_at > now(), false) AS live
      FROM leads WHERE id = ${leadId}::uuid
       FOR UPDATE`;
  const lead = rows[0];
  if (!lead) throw draftErrors.notFound();
  if (lead.status !== 'DRAFT' || !lead.live) throw notLive(lead.status);
  return { email: lead.email };
}

export const draftErrors = {
  notFound: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
  expired: () =>
    new GoneException({ code: 'DRAFT_EXPIRED', message: BEGIN_ONLINE_ERRORS.DRAFT_EXPIRED }),
  submitted: () =>
    new ConflictException({
      code: 'DRAFT_SUBMITTED',
      message: BEGIN_ONLINE_ERRORS.DRAFT_SUBMITTED,
    }),
  tooManyFiles: () =>
    new ConflictException({ code: 'TOO_MANY_FILES', message: BEGIN_ONLINE_ERRORS.TOO_MANY_FILES }),
  formChanged: () =>
    new ConflictException({
      code: 'FORM_CHANGED',
      message: 'This form was just updated. Please reload the page.',
    }),
  invalid: (issues: IntakeIssue[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted answers',
      details: { issues },
    }),
};

/**
 * R0's refusal of new data on a draft past its expiry (SQLSTATE 23514 from leads_draft_rules,
 * lead_uploads_unexpired_draft or intake_submissions_unexpired_draft) as 410 DRAFT_EXPIRED, or
 * undefined. The API checks the expiry first; this covers a draft that ran out in between.
 */
export function expiredDraftRefusal(error: unknown) {
  if (databaseErrorCode(error) !== '23514') return undefined;
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as { originalMessage?: unknown } | undefined;
  const text = [cause?.originalMessage, (error as Error | null)?.message]
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
  return /the draft expired|only an unexpired draft takes files/.test(text)
    ? draftErrors.expired()
    : undefined;
}

/** Rethrows R0's expired-draft refusal as 410 DRAFT_EXPIRED; anything else as it is. */
export const rethrowExpired = (error: unknown): never => {
  throw expiredDraftRefusal(error) ?? error;
};
