import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { portalCookies } from '@firmivra/types';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/** HKDF label for sign-up session keys; a new label (v2) ends every open sign-up. */
export const SIGN_UP_KEY_LABEL = 'fv-portal-signup-v1';
/** A sign-up has 30 minutes from its first page to its last. */
export const SIGN_UP_SECONDS = 30 * 60;

const SignUpSession = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.string(),
  firmSlug: z.string(),
  /** Null when the email already had an account here: the session goes nowhere. */
  clientAccountId: z.string().nullable(),
  email: z.string(),
  phone: z.string(),
  /** Sessions that go nowhere only: when "Resend Code" works again (ms since epoch). */
  resendAt: z.number(),
});
export type SignUpSession = z.infer<typeof SignUpSession>;

/**
 * What the sign-up cookie holds between the sign-up pages: which account and firm, never a code
 * (codes and attempts live in verification_codes). Sealed like the MFA challenge.
 */
export class SignUpSessions extends Sealer<SignUpSession> {
  constructor(secrets: PoolSecrets) {
    super(SIGN_UP_KEY_LABEL, SignUpSession, secrets);
  }
}

/** HttpOnly, host-only, Strict, only on this firm's sign-up routes. */
export function writeSignUpCookie(
  res: Response,
  firmSlug: string,
  sealed: string,
  expiresAt: number,
  secure: boolean,
): void {
  const names = portalCookies(firmSlug);
  res.cookie(names.signUp, sealed, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: names.signUpPath,
    maxAge: Math.max(0, expiresAt * 1000 - Date.now()),
  });
}

export const signUpErrors = {
  closed: () =>
    new ForbiddenException({
      code: 'SIGN_UP_CLOSED',
      message: 'This firm is not taking new sign-ups right now',
    }),
  termsOutdated: () =>
    new ConflictException({
      code: 'TERMS_OUTDATED',
      message: 'The Terms or Privacy policy changed. Please review them.',
    }),
  expired: () =>
    new GoneException({
      code: 'SIGN_UP_EXPIRED',
      message: 'Your sign-up timed out. Please start again.',
    }),
  codeInvalid: () =>
    new BadRequestException({
      code: 'CODE_INVALID',
      message: 'That code is not right or has expired',
    }),
  alreadyVerified: () =>
    new ConflictException({ code: 'ALREADY_VERIFIED', message: 'This is already verified' }),
  wrongStep: () =>
    new ConflictException({ code: 'WRONG_STEP', message: 'Please follow the steps in order' }),
};
