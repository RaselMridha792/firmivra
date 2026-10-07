import { ApiError, ApiRequestError } from '@firmivra/types';

/** The caller supplies only the business selected from the verified membership response. */
export async function workspaceRequest<T>(
  businessId: string,
  path: string,
  schema: { parse: (input: unknown) => T },
  options: { method?: 'GET' | 'PATCH' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (!businessId) throw new Error('Verified business required');
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-business-id': businessId,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiError.safeParse(body);
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : `HTTP_${response.status}`,
      'Workspace request failed',
    );
  }
  return schema.parse(body);
}

export function workspaceError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Your session expired. Sign in again.';
    if (error.status === 403) return 'Your current role does not permit this action.';
    if (error.status === 404) return 'This record is no longer available for your firm.';
    if (error.code === 'LAST_OWNER') return 'Keep at least one active owner in the firm.';
    if (error.status === 409)
      return 'The record changed or a required setup condition is missing. Refresh and try again.';
    if (error.status === 503)
      return 'This service is awaiting its storage, schema or delivery integration. No success has been reported.';
    if (error.status === 400) return 'Check the entered values and try again.';
  }
  return 'The request could not be completed. Retry when the service is available.';
}
