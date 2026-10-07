import type { z } from 'zod';
import {
  ApiError,
  BusinessSummary,
  DevTokenRequest,
  DevTokenResponse,
  HealthResponse,
  MeResponse,
  OkResponse,
} from './schemas.js';

/** Thrown for any non-2xx response. `code` comes from the API error body when there is one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Checks a client function's input before anything is sent. Bad input throws the same
 * ApiRequestError(400, 'VALIDATION_FAILED') the API would send, so screens handle one error type
 * (and mocks, which use this too, fail the same way).
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'The request is not valid';
    throw new ApiRequestError(400, 'VALIDATION_FAILED', message);
  }
  return result.data;
}

/** A query string from the defined values only (`?a=1&b=x`, or '' when none). */
export function toQuery(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export interface ApiClientOptions {
  /** For example '/api/v1' in the browser (same origin) or 'http://localhost:4000/api/v1' on the server. */
  baseUrl: string;
  /** Sent as a Bearer token. In the browser leave it out: the API's HttpOnly cookie is used. */
  token?: string;
  /** Firm to act in, for staff with more than one firm. */
  businessId?: string;
  fetch?: typeof fetch;
}

/**
 * The request function every module client is built on (`createTaxStatusesClient(request)`):
 * same headers, cookie and error handling everywhere. Parses the response with `schema`.
 */
export function createRequest(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;

  return async function request<S extends z.ZodType>(
    schema: S,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    if (options.businessId) headers['x-business-id'] = options.businessId;

    const res = await doFetch(`${options.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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

export type ApiRequest = ReturnType<typeof createRequest>;

export function createApiClient(options: ApiClientOptions) {
  const request = createRequest(options);

  return {
    health: () => request(HealthResponse, '/health'),
    me: () => request(MeResponse, '/me'),
    /** The firm the request acts in (staff). */
    currentBusiness: () => request(BusinessSummary, '/business'),
    /** A client's firm, by portal slug. */
    portalBusiness: (slug: string) =>
      request(BusinessSummary, `/portal/${encodeURIComponent(slug)}/business`),
    /** Local development only. */
    devToken: (body: DevTokenRequest) =>
      request(DevTokenResponse, '/dev/token', {
        method: 'POST',
        body: DevTokenRequest.parse(body),
      }),
    devSignOut: () => request(OkResponse, '/dev/sign-out', { method: 'POST' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
