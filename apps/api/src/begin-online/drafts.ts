import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TxClient } from '@firmivra/db';
import { beginOnlineCookie, type IntakeIssue } from '@firmivra/types';

/** A new draft key: 32 random bytes, base64url (43 characters). Only its SHA-256 is stored. */
export function newDraftToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The draft key this browser sent for this firm, or null. */
export function draftTokenOf(req: Request, firmSlug: string): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[
    beginOnlineCookie(firmSlug).name
  ];
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/** HttpOnly, host-only, Strict, only on this firm's Begin Online routes, until the draft ends. */
export function writeDraftCookie(
  res: Response,
  firmSlug: string,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  const { name, path } = beginOnlineCookie(firmSlug);
  res.cookie(name, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

/**
 * Renews a live draft in the database's clock: its expiry and its key's expiry both become 30
 * days from now, never past 90 days from its start (leads_draft_expiry, leads_rules), and with
 * `hash` the key is replaced. Only while the draft is live and still has the key `current`.
 * Returns the new expiry, or null when the draft is gone, expired or replaced.
 */
export async function renewDraft(
  tx: TxClient,
  leadId: string,
  current: string,
  hash: string | null = null,
): Promise<Date | null> {
  const rows = await tx.$queryRaw<{ draft_expires_at: Date }[]>`
    UPDATE leads
       SET draft_expires_at = e.at, resume_expires_at = e.at,
           resume_token_hash = coalesce(${hash}, resume_token_hash), updated_at = now()
      FROM (SELECT least(now() + interval '720 hours', now() + interval '30 days',
                         l.created_at + interval '2160 hours') AS at
              FROM leads l WHERE l.id = ${leadId}::uuid) e
     WHERE id = ${leadId}::uuid AND status = 'DRAFT' AND draft_expires_at > now()
       AND resume_token_hash = ${current}
    RETURNING draft_expires_at`;
  return rows[0]?.draft_expires_at ?? null;
}

export const draftErrors = {
  notFound: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
  noDraft: () =>
    new NotFoundException({
      code: 'DRAFT_NOT_FOUND',
      message: 'We could not find your saved form. Please start again.',
    }),
  expired: () =>
    new GoneException({
      code: 'DRAFT_EXPIRED',
      message: 'Your saved form has expired. Please start again.',
    }),
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
