import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AccountType, portalCookies } from '@firmivra/types';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/** HKDF label for sign-up session keys; v3 ends every earlier sign-up (the shape changed). */
export const SIGN_UP_KEY_LABEL = 'fv-portal-signup-v3';
/** A sign-up has 30 minutes from its first page to its last. */
export const SIGN_UP_SECONDS = 30 * 60;

/**
 * What the sign-up cookie holds between the sign-up pages. The same fields, of the same length,
 * on every path (#51 review: a cookie must not show whether the email has an account). The
 * resend gap and the request count live on the server, per attempt, so replaying an older cookie
 * resets nothing:
 * - `userId`: this attempt's own login (its password, name and phone), made for every sign-up.
 *   It doubles as the attempt id: codes are bound to it, and an older attempt's cookie never
 *   acts for a newer one.
 * - `clientAccountId`: the account this attempt is for, or a random id when it goes nowhere.
 * Never a code: codes and attempts live in verification_codes.
 */
const SignUpSession = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.string(),
  firmSlug: z.string(),
  clientAccountId: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  phone: z.string(),
  accountType: AccountType,
  /**
   * The Terms and Privacy ids this attempt accepted. Written for the account when the attempt
   * creates it, or when it takes over an unfinished one, never onto someone else's account before.
   */
  documents: z.array(z.uuid()).length(2),
});
export type SignUpSession = z.infer<typeof SignUpSession>;

/** Sealed like the MFA challenge: the browser can neither read nor change it. */
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
  rateLimited: () =>
    new HttpException(
      // One answer for every limit (some last a day), so it shows nothing about the email.
      { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
};
