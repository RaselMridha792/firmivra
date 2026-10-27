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
  ApproveSignUpRequest,
  ApproveSignUpResponse,
  ChangeEmailRequest,
  ChangePhoneRequest,
  ClientSignUpDetail,
  ClientSignUpList,
  ClientSignUpSettings,
  ClientSignUpsQuery,
  DeclineSignUpRequest,
  DeclineSignUpResponse,
  KeepSignUpPendingRequest,
  KeepSignUpPendingResponse,
  LegalDocument,
  LinkSignUpRequest,
  type LegalKind,
  PortalInfo,
  RecordSignUpChecksRequest,
  ResendCodeRequest,
  RestoreSignUpAccessRequest,
  RestoreSignUpAccessResponse,
  SignUpNotAMatchRequest,
  SignUpNotAMatchResponse,
  SignUpRequest,
  SignUpState,
  UpdateClientSignUpSettingsRequest,
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
 * `api.clientSignUps` (apps/web/src/lib/api.ts): the firm's Client Sign-ups, for the owner and
 * admins: the three tabs with their counts, one request with its history, and the approval mode.
 */
export function createClientSignUpsClient(request: ApiRequest) {
  return {
    list: async (query: ClientSignUpsQuery = {}): Promise<ClientSignUpList> => {
      const q = parseInput(ClientSignUpsQuery, query);
      const params = new URLSearchParams({
        status: q.status,
        sort: q.sort,
        page: String(q.page),
        limit: String(q.limit),
      });
      for (const key of ['search', 'from', 'to', 'match'] as const) {
        const value = q[key];
        if (value) params.set(key, value);
      }
      return request(ClientSignUpList, `${SIGN_UPS}?${params.toString()}`);
    },
    /** One request with its history and, while it waits, the records it may belong to. 404. */
    get: async (clientAccountId: string): Promise<ClientSignUpDetail> =>
      request(ClientSignUpDetail, one(clientAccountId)),
    settings: async (): Promise<ClientSignUpSettings> =>
      request(ClientSignUpSettings, `${SIGN_UPS}/settings`),
    /** Changes the approval mode. 409 STALE_VERSION or IDEMPOTENCY_KEY_REUSED. */
    updateSettings: async (
      body: UpdateClientSignUpSettingsRequest,
    ): Promise<ClientSignUpSettings> =>
      request(ClientSignUpSettings, `${SIGN_UPS}/settings`, {
        method: 'PATCH',
        body: parseInput(UpdateClientSignUpSettingsRequest, body),
      }),
    /**
     * Creates the client record, or links to `{ clientId }` so the firm gets no duplicate.
     * 409 NOT_PENDING, DUPLICATE_EMAIL or POTENTIAL_MATCH; 404 for an unknown clientId.
     */
    approve: async (
      clientAccountId: string,
      body: ApproveSignUpRequest,
    ): Promise<ApproveSignUpResponse> =>
      request(ApproveSignUpResponse, `${one(clientAccountId)}/approve`, {
        method: 'POST',
        body: parseInput(ApproveSignUpRequest, body),
      }),
    /** Closes the login; the client gets an email. 409 NOT_PENDING. */
    decline: async (
      clientAccountId: string,
      body: DeclineSignUpRequest,
    ): Promise<DeclineSignUpResponse> =>
      request(DeclineSignUpResponse, `${one(clientAccountId)}/decline`, {
        method: 'POST',
        body: parseInput(DeclineSignUpRequest, body),
      }),
    /** Records the three checks for one candidate record; answers the detail. */
    recordChecks: async (
      clientAccountId: string,
      body: RecordSignUpChecksRequest,
    ): Promise<ClientSignUpDetail> =>
      request(ClientSignUpDetail, `${one(clientAccountId)}/checks`, {
        method: 'POST',
        body: parseInput(RecordSignUpChecksRequest, body),
      }),
    /** Link Existing Record after the checks. 409 CHECKS_REQUIRED or CLIENT_NOT_LINKABLE. */
    link: async (
      clientAccountId: string,
      body: LinkSignUpRequest,
    ): Promise<ApproveSignUpResponse> =>
      request(ApproveSignUpResponse, `${one(clientAccountId)}/link`, {
        method: 'POST',
        body: parseInput(LinkSignUpRequest, body),
      }),
    /** Restore Access after the checks. 409 CHECKS_REQUIRED or NO_PORTAL_LOGIN. */
    restoreAccess: async (
      clientAccountId: string,
      body: RestoreSignUpAccessRequest,
    ): Promise<RestoreSignUpAccessResponse> =>
      request(RestoreSignUpAccessResponse, `${one(clientAccountId)}/restore-access`, {
        method: 'POST',
        body: parseInput(RestoreSignUpAccessRequest, body),
      }),
    /** The open phone matches are not this person. 409 DUPLICATE_EMAIL for an email match. */
    notAMatch: async (
      clientAccountId: string,
      body: SignUpNotAMatchRequest,
    ): Promise<SignUpNotAMatchResponse> =>
      request(SignUpNotAMatchResponse, `${one(clientAccountId)}/not-a-match`, {
        method: 'POST',
        body: parseInput(SignUpNotAMatchRequest, body),
      }),
    /** Keep Pending with an optional note; nothing changes. */
    keepPending: async (
      clientAccountId: string,
      body: KeepSignUpPendingRequest,
    ): Promise<KeepSignUpPendingResponse> =>
      request(KeepSignUpPendingResponse, `${one(clientAccountId)}/keep-pending`, {
        method: 'POST',
        body: parseInput(KeepSignUpPendingRequest, body),
      }),
  };
}

export type PortalAuthClient = ReturnType<typeof createPortalAuthClient>;
export type ClientSignUpsClient = ReturnType<typeof createClientSignUpsClient>;
