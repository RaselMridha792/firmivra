import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthFlowError, type AuthFlowErrorCode } from './identity/identity-provider.js';

/** The API error for each expected sign-in failure (codes in docs/api/auth.yaml). */
const HTTP_ERRORS: Record<AuthFlowErrorCode, () => HttpException> = {
  INVALID_CREDENTIALS: () =>
    new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    }),
  MFA_CODE_INVALID: () =>
    new UnauthorizedException({ code: 'MFA_CODE_INVALID', message: 'That code is not right' }),
  CHALLENGE_EXPIRED: () =>
    new UnauthorizedException({
      code: 'CHALLENGE_EXPIRED',
      message: 'Sign-in timed out. Please sign in again.',
    }),
  SESSION_EXPIRED: () =>
    new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' }),
  RESET_CODE_INVALID: () =>
    new BadRequestException({
      code: 'RESET_CODE_INVALID',
      message: 'That code is not right or has expired',
    }),
  PASSWORD_REJECTED: () =>
    new BadRequestException({
      code: 'PASSWORD_REJECTED',
      message: 'Choose a different password',
    }),
  RATE_LIMITED: () =>
    new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
};

export const httpError = (code: AuthFlowErrorCode): HttpException => HTTP_ERRORS[code]();

/** Runs an identity-provider call and turns its expected failures into API errors. */
export async function runFlow<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof AuthFlowError) throw httpError(e.code);
    throw e;
  }
}
