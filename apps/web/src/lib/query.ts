import { ApiRequestError } from '@firmivra/types';
import {
  type MutationOptions,
  type QueryClient,
  type QueryKey,
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

/**
 * Data hooks for screens (TanStack Query). A screen never calls fetch: it reads with
 * useApiQuery and changes data with useApiMutation, both around an `api.<module>.<fn>()` call.
 */

/** Retry a network failure once. An answer from the API (4xx or 5xx) won't change: don't retry. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  !(error instanceof ApiRequestError) && failureCount < 1;

/**
 * Reads data. `key` names the data in the cache, for example ['tax-statuses'] or
 * ['clients', clientId]; use the same key in `invalidate` after a change.
 *   const statuses = useApiQuery(['tax-statuses'], () => api.taxStatuses.list());
 * Pass the result to <PageState query={statuses}> for the loading, empty and error states.
 */
export function useApiQuery<T>(key: QueryKey, fn: () => Promise<T>): UseQueryResult<T> {
  return useQuery({ queryKey: key, queryFn: fn });
}

/**
 * Changes data, from the browser only (a click or a form submit in a 'use client' component).
 * After success it refetches every query whose key starts with `invalidate`.
 *   const create = useApiMutation((body: CreateTaxStatusRequest) => api.taxStatuses.create(body),
 *     { invalidate: ['tax-statuses'] });
 *   create.mutate({ name }); then create.isPending, create.error (show with errorMessage).
 */
export interface ApiMutationOptions<TInput, TResult> {
  invalidate?: QueryKey;
  /**
   * Runs on success before the refetch, also when the component that called `mutate` is gone by
   * then (a `mutate(input, { onSuccess })` callback is dropped once its component unmounts, and
   * the refetch can unmount it): for a message the parent shows, when the change removes what
   * was clicked (Appointments Review 2 row 8: Confirm in the portal).
   */
  onSuccess?: (result: TResult, input: TInput) => void;
}

/** useApiMutation's options for TanStack Query (exported for its unit test). */
export function apiMutationOptions<TInput, TResult>(
  client: QueryClient,
  fn: (input: TInput) => Promise<TResult>,
  { invalidate, onSuccess }: ApiMutationOptions<TInput, TResult> = {},
): MutationOptions<TResult, Error, TInput> {
  return {
    mutationFn: fn,
    onSuccess: async (result, input) => {
      onSuccess?.(result, input);
      if (invalidate) await client.invalidateQueries({ queryKey: invalidate });
    },
  };
}

export function useApiMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  options: ApiMutationOptions<TInput, TResult> = {},
): UseMutationResult<TResult, Error, TInput> {
  return useMutation(apiMutationOptions(useQueryClient(), fn, options));
}
