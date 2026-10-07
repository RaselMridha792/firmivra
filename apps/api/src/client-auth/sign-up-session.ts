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

/** HKDF label for sign-up session keys; v2 ends every v1 sign-up (#51 review: new shape). */
export const SIGN_UP_KEY_LABEL = 'fv-portal-signup-v2';
/** A sign-up has 30 minutes from its first page to its last. */
export const SIGN_UP_SECONDS = 30 * 60;

/**
 * What the sign-up cookie holds between the sign-up pages. The same fields, of the same length,
 * on every path (#51 review: a cookie must not show whether the email has an account):
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
  /** When "Resend Code" works again on the paths without codes (ms since epoch). */
  resendAt: z.number(),
  /** Code requests in this session, sign-up included; capped alike on every path. */
  sends: z.number(),
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
      { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
};
