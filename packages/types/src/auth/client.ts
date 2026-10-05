import type { z } from 'zod';
import { ApiRequestError, type ApiClientOptions } from '../client.js';
import { ApiError, OkResponse } from '../schemas.js';
import {
  ActivateRequest,
  ActivationCheckRequest,
  ActivationCheckResponse,
  AUTH_BASE_PATH,
  type AuthSite,
  CreateInviteRequest,
  ForgotPasswordRequest,
  InviteResponse,
  MfaRequest,
  MfaSetupRequest,
  MfaSetupResponse,
  ResetPasswordRequest,
  SignInRequest,
  SignInResult,
  SignOutRequest,
} from './schemas.js';

/** Same options as createApiClient. In the browser leave out `token`: the cookies are used. */
export type AuthClientOptions = ApiClientOptions;

function createPost(options: AuthClientOptions) {
  const doFetch = options.fetch ?? fetch;
  /** Checks the body inside the promise, so a bad body rejects like an API error would. */
  return async function post<S extends z.ZodType>(
    schema: S,
    path: string,
    bodySchema?: z.ZodType,
    input?: unknown,
  ): Promise<z.infer<S>> {
    const body: unknown = bodySchema ? bodySchema.parse(input) : undefined;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    if (options.businessId) headers['x-business-id'] = options.businessId;

    const res = await doFetch(`${options.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = ApiError.safeParse(json);
      const e = parsed.success ? parsed.data.error : undefined;
      throw new ApiRequestError(
        res.status,
        e?.code ?? `HTTP_${res.status}`,
        e?.message ?? res.statusText,
        e?.requestId,
      );
    }
    return schema.parse(json);
  };
}

function sessionCalls(post: ReturnType<typeof createPost>, site: AuthSite) {
  const base = AUTH_BASE_PATH[site];
  return {
    signIn: (body: SignInRequest) => post(SignInResult, `${base}/sign-in`, SignInRequest, body),
    /** The code for MFA_REQUIRED, or the first code after startMfaSetup. */
    submitMfaCode: (body: MfaRequest) => post(SignInResult, `${base}/mfa`, MfaRequest, body),
    /** After MFA_SETUP_REQUIRED: get the secret and QR URI, then submitMfaCode. */
    startMfaSetup: (body: MfaSetupRequest) =>
      post(MfaSetupResponse, `${base}/mfa/setup`, MfaSetupRequest, body),
    /** Renews the access cookie. UNAUTHENTICATED means sign in again. */
    refresh: () => post(OkResponse, `${base}/refresh`),
    signOut: (body: SignOutRequest = {}) =>
      post(OkResponse, `${base}/sign-out`, SignOutRequest, body),
    forgotPassword: (body: ForgotPasswordRequest) =>
      post(OkResponse, `${base}/forgot-password`, ForgotPasswordRequest, body),
    resetPassword: (body: ResetPasswordRequest) =>
      post(OkResponse, `${base}/reset-password`, ResetPasswordRequest, body),
  };
}

/** Firm site (app.firmivra.com): staff sign-in, activation and team invites. */
export function createStaffAuthClient(options: AuthClientOptions) {
  const post = createPost(options);
  const base = AUTH_BASE_PATH.firm;
  return {
    ...sessionCalls(post, 'firm'),
    checkActivation: (body: ActivationCheckRequest) =>
      post(ActivationCheckResponse, `${base}/activation/check`, ActivationCheckRequest, body),
    /** Sets the password; the result is MFA_SETUP_REQUIRED. */
    activate: (body: ActivateRequest) =>
      post(SignInResult, `${base}/activate`, ActivateRequest, body),
    /** Owner or admin of the current firm (`businessId` option for staff with several firms). */
    createInvite: (body: CreateInviteRequest) =>
      post(InviteResponse, `${base}/invites`, CreateInviteRequest, body),
  };
}

/** Super Admin site (admin.firmivra.com). */
export function createAdminAuthClient(options: AuthClientOptions) {
  return sessionCalls(createPost(options), 'admin');
}

export type StaffAuthClient = ReturnType<typeof createStaffAuthClient>;
export type AdminAuthClient = ReturnType<typeof createAdminAuthClient>;
