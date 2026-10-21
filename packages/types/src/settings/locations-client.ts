import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { UploadPutTicket } from '../documents/schemas.js';
import {
  ConfirmLocationPhotoUploadRequest,
  CreateLocationPhotoUploadRequest,
  CreateLocationRequest,
  DeactivateLocationRequest,
  DeactivateManagerRequest,
  LocationAction,
  LocationActionList,
  LocationActionsQuery,
  LocationActivity,
  LocationActivityQuery,
  LocationList,
  LocationOptions,
  LocationProfile,
  LocationsQuery,
  ReassignManagerRequest,
  SetLocationStaffRequest,
  UpdateLocationActionRequest,
  UpdateLocationRequest,
} from './locations.js';

const Id = z.uuid();
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const base = '/business/locations';
const one = (id: string) => `${base}/${parseInput(Id, id)}`;

/** `api.locations`: Settings > Locations (see locations.ts). Owner and Admin. */
export function createLocationsClient(request: ApiRequest) {
  return {
    list: async (query: LocationsQuery = {}): Promise<LocationList> =>
      request(LocationList, `${base}${toQuery(parseInput(LocationsQuery, query))}`),
    options: async (): Promise<LocationOptions> => request(LocationOptions, `${base}/options`),
    get: async (id: string): Promise<LocationProfile> => request(LocationProfile, one(id)),
    /** Add Location. 409 DUPLICATE_LOCATION, LOCATION_LIMIT. */
    create: async (body: CreateLocationRequest): Promise<LocationProfile> =>
      request(LocationProfile, base, post(parseInput(CreateLocationRequest, body))),
    /** Save Changes. 409 SAVE_CONFLICT, DUPLICATE_LOCATION. */
    update: async (id: string, body: UpdateLocationRequest): Promise<LocationProfile> =>
      request(LocationProfile, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateLocationRequest, body),
      }),
    /** Set as Primary (an ACTIVE location). */
    setPrimary: async (id: string): Promise<LocationProfile> =>
      request(LocationProfile, `${one(id)}/primary`, post()),
    /** Activate. 409 LOCATION_LIMIT. */
    activate: async (id: string): Promise<LocationProfile> =>
      request(LocationProfile, `${one(id)}/activate`, post()),
    /** Deactivate now or later (Super Administrator). 409 LOCATION_IS_PRIMARY, PENDING_ACTION_EXISTS. */
    deactivate: async (
      id: string,
      body: DeactivateLocationRequest = {},
    ): Promise<LocationProfile> =>
      request(
        LocationProfile,
        `${one(id)}/deactivate`,
        post(parseInput(DeactivateLocationRequest, body)),
      ),
    /** Reassign Manager now or later. 409 PENDING_ACTION_EXISTS; 400 MANAGER_NOT_ELIGIBLE. */
    reassignManager: async (id: string, body: ReassignManagerRequest): Promise<LocationProfile> =>
      request(
        LocationProfile,
        `${one(id)}/manager`,
        post(parseInput(ReassignManagerRequest, body)),
      ),
    /** Manage Staff: who works there (replaces the set). */
    setStaff: async (id: string, body: SetLocationStaffRequest): Promise<LocationProfile> =>
      request(LocationProfile, `${one(id)}/staff`, {
        method: 'PUT',
        body: parseInput(SetLocationStaffRequest, body),
      }),
    /** Deactivate Manager now or later (Super Administrator). */
    deactivateManager: async (
      userId: string,
      body: DeactivateManagerRequest,
    ): Promise<LocationAction> =>
      request(
        LocationAction,
        `${base}/managers/${parseInput(Id, userId)}/deactivate`,
        post(parseInput(DeactivateManagerRequest, body)),
      ),
    /** Scheduled changes, newest first. */
    actions: async (query: LocationActionsQuery = {}): Promise<LocationActionList> =>
      request(
        LocationActionList,
        `${base}/actions${toQuery(parseInput(LocationActionsQuery, query))}`,
      ),
    /** Edit Schedule (Super Administrator, while PENDING). 409 ACTION_FINISHED. */
    updateAction: async (id: string, body: UpdateLocationActionRequest): Promise<LocationAction> =>
      request(LocationAction, `${base}/actions/${parseInput(Id, id)}`, {
        method: 'PATCH',
        body: parseInput(UpdateLocationActionRequest, body),
      }),
    /** Cancel Schedule (Super Administrator, while PENDING). 409 ACTION_FINISHED. */
    cancelAction: async (id: string): Promise<LocationAction> =>
      request(LocationAction, `${base}/actions/${parseInput(Id, id)}/cancel`, post()),
    /** Recent Location Activity; "View All Activity" opens the audit log. */
    activity: async (query: LocationActivityQuery = {}): Promise<LocationActivity> =>
      request(
        LocationActivity,
        `${base}/activity${toQuery(parseInput(LocationActivityQuery, query))}`,
      ),
    /** The photo, in three steps like the logo: a PUT ticket, the PUT, then confirm. */
    createPhotoUpload: async (
      id: string,
      body: CreateLocationPhotoUploadRequest,
    ): Promise<UploadPutTicket> =>
      request(
        UploadPutTicket,
        `${one(id)}/photo/uploads`,
        post(parseInput(CreateLocationPhotoUploadRequest, body)),
      ),
    confirmPhotoUpload: async (
      id: string,
      body: ConfirmLocationPhotoUploadRequest,
    ): Promise<LocationProfile> =>
      request(
        LocationProfile,
        `${one(id)}/photo/uploads/confirm`,
        post(parseInput(ConfirmLocationPhotoUploadRequest, body)),
      ),
    removePhoto: async (id: string): Promise<LocationProfile> =>
      request(LocationProfile, `${one(id)}/photo`, { method: 'DELETE' }),
  };
}
export type LocationsClient = ReturnType<typeof createLocationsClient>;
