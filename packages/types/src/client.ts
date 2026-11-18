import type { z } from 'zod';
import {
  ApiError,
  ApiErrorDetails,
  BusinessSummary,
  DevSignOutRequest,
  DevTokenRequest,
  DevTokenResponse,
  HealthResponse,
  MeResponse,
  OkResponse,
  type ApiErrorDetail,
} from './schemas.js';

/** Thrown for any non-2xx response. `code` comes from the API error body when there is one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    /** Seconds to wait before trying again, from the response's Retry-After (a 429 or 503). */
    readonly retryAfter?: number,
    /** The body's `details` when they are `{ path, message }` lines: what is wrong or missing. */
    readonly details?: ApiErrorDetail[],
    /** The body's `details` as sent, whatever their shape (e.g. DUPLICATE_PHONE's matches). */
    readonly rawDetails?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Retry-After in whole seconds, the only form the API sends; anything else is ignored. */
function retryAfterSeconds(header: string | null): number | undefined {
  const value = header?.trim() ?? '';
  if (!/^\d{1,4}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 ? seconds : undefined;
}

/** Longest wait between two tries in `retryWhenUnavailable`, whatever Retry-After says. */
const MAX_RETRY_WAIT_SECONDS = 30;
/** The wait when a 503 has no Retry-After. */
const DEFAULT_RETRY_WAIT_SECONDS = 5;

/** Resolves after `ms`, or rejects with an AbortError as soon as `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => new DOMException('Cancelled', 'AbortError');
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Calls `call` again while it fails with a 503 (the API or its storage is busy for a moment):
 * waits the response's Retry-After (5 seconds without one, at most 30), at most `retries` times
 * (3), then rejects with the last error. Any other error rejects at once. Only for calls that are
 * safe to repeat, such as confirming an upload with the same token. A cancel via `signal` ends
 * the wait at once with an AbortError.
 */
export async function retryWhenUnavailable<T>(
  call: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    retries?: number;
    /** Tests only: replaces the real wait. */
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<T> {
  const { signal, retries = 3, wait = pause } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 503 || attempt >= retries) {
        throw error;
      }
      const seconds = Math.min(
        error.retryAfter ?? DEFAULT_RETRY_WAIT_SECONDS,
        MAX_RETRY_WAIT_SECONDS,
      );
      await wait(seconds * 1000, signal);
    }
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
    if (!res.ok) throw requestError(res, json);
    return schema.parse(json);
  };
}

export type ApiRequest = ReturnType<typeof createRequest>;

/** The ApiRequestError for a non-2xx response and its body (read as JSON, if it was). */
function requestError(res: Response, json: unknown): ApiRequestError {
  const parsed = ApiError.safeParse(json);
  const e = parsed.success ? parsed.data.error : undefined;
  const details = ApiErrorDetails.safeParse(e?.details);
  return new ApiRequestError(
    res.status,
    e?.code ?? `HTTP_${res.status}`,
    e?.message ?? res.statusText,
    e?.requestId,
    retryAfterSeconds(res.headers.get('retry-after')),
    details.success ? details.data : undefined,
    e?.details,
  );
}

/** A file the API sends (an export): its name, its media type and its text. */
export interface ApiFile {
  name: string;
  type: string;
  text: string;
}

/** The file name a Content-Disposition header gives (`filename="audit-log.csv"`). */
function fileNameOf(header: string | null): string | undefined {
  const name = /filename="([^"\\/]{1,120})"/.exec(header ?? '')?.[1];
  return name?.trim() || undefined;
}

/**
 * Downloads a file (a CSV export) with the same headers, cookie and errors as `request`, so the
 * browser's session refresh applies (a plain link would get a raw 401 once the access cookie
 * expires) and a refusal is an ApiRequestError the screen can show.
 */
export function createDownload(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;

  return async function download(path: string, fallbackName: string): Promise<ApiFile> {
    const headers: Record<string, string> = { accept: 'text/csv, application/json' };
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    if (options.businessId) headers['x-business-id'] = options.businessId;
    const res = await doFetch(`${options.baseUrl}${path}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!res.ok) throw requestError(res, await res.json().catch(() => undefined));
    return {
      name: fileNameOf(res.headers.get('content-disposition')) ?? fallbackName,
      type: res.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      text: await res.text(),
    };
  };
}

export type ApiDownload = ReturnType<typeof createDownload>;

/** The records of a CSV after its header line (a quoted cell may hold a line break). */
export function csvRecordCount(csv: string): number {
  let rows = 0;
  let quoted = false;
  let content = false;
  for (const char of csv) {
    if (char === '"') quoted = !quoted;
    if (char === '\n' && !quoted) {
      if (content) rows += 1;
      content = false;
    } else if (char !== '\r' && char !== '\uFEFF') content = true;
  }
  if (content) rows += 1;
  return Math.max(0, rows - 1);
}

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
    /** With `firmSlug`, that firm's portal cookie is cleared too. */
    devSignOut: (firmSlug?: string) =>
      request(OkResponse, '/dev/sign-out', {
        method: 'POST',
        ...(firmSlug ? { body: parseInput(DevSignOutRequest, { firmSlug }) } : {}),
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
