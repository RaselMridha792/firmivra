import { type ApiClientOptions } from '../client.js';
import { createRequests } from '../auth/client.js';
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

export interface PortalAuthClientOptions extends ApiClientOptions {
  /** The firm's portal slug, for example "lvp". */
  firmSlug: string;
}

/**
 * Client portal (portal.firmivra.com/{firmSlug}): public reads, sign-up with email and phone
 * verification, sign-in and session. The sign-up session lives in an HttpOnly cookie, so the
 * pages store nothing: each page calls signUpState() to know where the sign-up stands.
 */
export function createPortalAuthClient(options: PortalAuthClientOptions) {
  const { get, post } = createRequests(options);
  const portal = `/portal/${encodeURIComponent(options.firmSlug.toLowerCase())}`;
  const auth = `${portal}/auth`;
  return {
    info: () => get(PortalInfo, `${portal}/info`),
    legal: (kind: LegalKind) => get(LegalDocument, `${portal}/legal/${kind}`),

    signUp: (body: SignUpRequest) => post(SignUpState, `${auth}/sign-up`, SignUpRequest, body),
    /** Where the sign-up stands. 410 SIGN_UP_EXPIRED: send the person back to /sign-up. */
    signUpState: () => get(SignUpState, `${auth}/sign-up`),
    verifyEmail: (body: VerifyCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/verify-email`, VerifyCodeRequest, body),
    verifyPhone: (body: VerifyCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/verify-phone`, VerifyCodeRequest, body),
    resendCode: (body: ResendCodeRequest) =>
      post(SignUpState, `${auth}/sign-up/resend`, ResendCodeRequest, body),
    changeEmail: (body: ChangeEmailRequest) =>
      post(SignUpState, `${auth}/sign-up/change-email`, ChangeEmailRequest, body),
    changePhone: (body: ChangePhoneRequest) =>
      post(SignUpState, `${auth}/sign-up/change-phone`, ChangePhoneRequest, body),

    signIn: (body: SignInRequest) => post(SignInResult, `${auth}/sign-in`, SignInRequest, body),
    submitMfaCode: (body: MfaRequest) => post(SignInResult, `${auth}/mfa`, MfaRequest, body),
    startMfaSetup: (body: MfaSetupRequest) =>
      post(MfaSetupResponse, `${auth}/mfa/setup`, MfaSetupRequest, body),
    refresh: () => post(OkResponse, `${auth}/refresh`),
    signOut: (body: SignOutRequest = {}) =>
      post(OkResponse, `${auth}/sign-out`, SignOutRequest, body),
    forgotPassword: (body: ForgotPasswordRequest) =>
      post(OkResponse, `${auth}/forgot-password`, ForgotPasswordRequest, body),
    resetPassword: (body: ResetPasswordRequest) =>
      post(OkResponse, `${auth}/reset-password`, ResetPasswordRequest, body),
    /** The signed-in client of this firm. `clientAccounts[0].status` PENDING_APPROVAL: /sign-up/done. */
    me: () => get(MeResponse, `${portal}/me`),
  };
}

/** Firm site: the pending sign-ups queue (owner and admin; `businessId` for staff with several firms). */
export function createClientSignUpsClient(options: ApiClientOptions) {
  const { get, post } = createRequests(options);
  const base = '/client-sign-ups';
  return {
    list: (query: ClientSignUpsQuery = {}) => {
      const q = ClientSignUpsQuery.parse(query);
      const params = new URLSearchParams({ status: q.status, limit: String(q.limit) });
      if (q.cursor) params.set('cursor', q.cursor);
      return get(ClientSignUpList, `${base}?${params.toString()}`);
    },
    approve: (clientAccountId: string) =>
      post(ApproveSignUpResponse, `${base}/${encodeURIComponent(clientAccountId)}/approve`),
    decline: (clientAccountId: string, body: DeclineSignUpRequest = {}) =>
      post(
        DeclineSignUpResponse,
        `${base}/${encodeURIComponent(clientAccountId)}/decline`,
        DeclineSignUpRequest,
        body,
      ),
  };
}

export type PortalAuthClient = ReturnType<typeof createPortalAuthClient>;
export type ClientSignUpsClient = ReturnType<typeof createClientSignUpsClient>;
