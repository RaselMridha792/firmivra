import type { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import {
  ForgotPasswordRequest,
  MfaRequest,
  MfaSetupRequest,
  MfaSetupResponse,
  ResetPasswordRequest,
  SignInRequest,
  SignInResult,
  SignOutRequest,
} from '../auth/schemas.js';
import { MeResponse, OkResponse } from '../schemas.js';
import {
  ApproveSignUpResponse,
  ChangeEmailRequest,
  ChangePhoneRequest,
  ClientSignUpList,
  ClientSignUpsQuery,
  DeclineSignUpRequest,
  DeclineSignUpResponse,
  LegalDocument,
  type LegalKind,
  PortalInfo,
  ResendCodeRequest,
  SignUpRequest,
  SignUpState,
  VerifyCodeRequest,
} from './schemas.js';

/**
 * `portalAuth(slug)` (apps/web/src/lib/auth.ts): one firm's client portal
 * (portal.firmivra.com/{firmSlug}): public reads, sign-up with email and phone verification,
 * sign-in, session and /me. The sign-up session lives in an HttpOnly cookie, so the pages store
 * nothing: each sign-up page calls signUpState() first. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent, the same error the API gives.
 */
export function createPortalAuthClient(request: ApiRequest, firmSlug: string) {
  const portal = `/portal/${encodeURIComponent(firmSlug.toLowerCase())}`;
  const auth = `${portal}/auth`;
  const post = <S extends z.ZodType>(schema: S, path: string, body?: unknown) =>
    request(schema, path, { method: 'POST', body });

  return {
    info: async () => request(PortalInfo, `${portal}/info`),
    legal: async (kind: LegalKind) => request(LegalDocument, `${portal}/legal/${kind}`),

    signUp: async (body: SignUpRequest) =>
      post(SignUpState, `${auth}/sign-up`, parseInput(SignUpRequest, body)),
    /** Where the sign-up stands. 410 SIGN_UP_EXPIRED: send the person back to /sign-up. */
    signUpState: async () => request(SignUpState, `${auth}/sign-up`),
    verifyEmail: async (body: VerifyCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/verify-email`, parseInput(VerifyCodeRequest, body)),
    verifyPhone: async (body: VerifyCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/verify-phone`, parseInput(VerifyCodeRequest, body)),
    resendCode: async (body: ResendCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/resend`, parseInput(ResendCodeRequest, body)),
    changeEmail: async (body: ChangeEmailRequest) =>
      post(SignUpState, `${auth}/sign-up/change-email`, parseInput(ChangeEmailRequest, body)),
    changePhone: async (body: ChangePhoneRequest) =>
      post(SignUpState, `${auth}/sign-up/change-phone`, parseInput(ChangePhoneRequest, body)),

    signIn: async (body: SignInRequest) =>
      post(SignInResult, `${auth}/sign-in`, parseInput(SignInRequest, body)),
    submitMfaCode: async (body: MfaRequest) =>
      post(SignInResult, `${auth}/mfa`, parseInput(MfaRequest, body)),
    startMfaSetup: async (body: MfaSetupRequest) =>
      post(MfaSetupResponse, `${auth}/mfa/setup`, parseInput(MfaSetupRequest, body)),
    refresh: async () => post(OkResponse, `${auth}/refresh`),
    signOut: async (body: SignOutRequest = {}) =>
      post(OkResponse, `${auth}/sign-out`, parseInput(SignOutRequest, body)),
    forgotPassword: async (body: ForgotPasswordRequest) =>
      post(OkResponse, `${auth}/forgot-password`, parseInput(ForgotPasswordRequest, body)),
    resetPassword: async (body: ResetPasswordRequest) =>
      post(OkResponse, `${auth}/reset-password`, parseInput(ResetPasswordRequest, body)),
    /** This firm's signed-in client. clientAccounts[0].status PENDING_APPROVAL: /sign-up/done. */
    me: async () => request(MeResponse, `${portal}/me`),
  };
}

const SIGN_UPS = '/client-sign-ups';
const one = (id: string) => `${SIGN_UPS}/${encodeURIComponent(id)}`;

/**
 * `api.clientSignUps` (apps/web/src/lib/api.ts): the firm's pending client sign-ups, for the
 * owner and admins. Oldest first, paged with `nextCursor`.
 */
export function createClientSignUpsClient(request: ApiRequest) {
  return {
    list: async (query: ClientSignUpsQuery = {}): Promise<ClientSignUpList> => {
      const q = parseInput(ClientSignUpsQuery, query);
      const params = new URLSearchParams({ status: q.status, limit: String(q.limit) });
      if (q.cursor) params.set('cursor', q.cursor);
      return request(ClientSignUpList, `${SIGN_UPS}?${params.toString()}`);
    },
    /** Creates the client record; the client gets an email. 409 NOT_PENDING. */
    approve: async (clientAccountId: string): Promise<ApproveSignUpResponse> =>
      request(ApproveSignUpResponse, `${one(clientAccountId)}/approve`, { method: 'POST' }),
    /** Closes the login; the client gets an email. 409 NOT_PENDING. */
    decline: async (
      clientAccountId: string,
      body: DeclineSignUpRequest = {},
    ): Promise<DeclineSignUpResponse> =>
      request(DeclineSignUpResponse, `${one(clientAccountId)}/decline`, {
        method: 'POST',
        body: parseInput(DeclineSignUpRequest, body),
      }),
  };
}

export type PortalAuthClient = ReturnType<typeof createPortalAuthClient>;
export type ClientSignUpsClient = ReturnType<typeof createClientSignUpsClient>;
