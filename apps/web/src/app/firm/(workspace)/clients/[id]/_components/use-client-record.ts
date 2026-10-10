import { ApiRequestError, ClientId } from '@firmivra/types';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { clientKey } from '../../_components/client-parts';

/**
 * The client's record, shared by the layout and the Overview (one request). An id that can't be
 * a client's is "not found", as the API answers for a client this person can't see.
 */
export function useClientRecord(id: string) {
  return useApiQuery(clientKey(id), () =>
    ClientId.safeParse(id).success
      ? api.clients.get(id)
      : Promise.reject(new ApiRequestError(404, 'NOT_FOUND', 'Not found')),
  );
}
