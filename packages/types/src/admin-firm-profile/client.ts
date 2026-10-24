import { type ApiRequest, parseInput } from '../client.js';
import {
  AdminFirmId,
  ApplyProfileChangeRequest,
  AppliedProfileChange,
  FirmProfileChanges,
  ProfileChangeTicketId,
} from './schemas.js';

const changes = (firmId: string) =>
  `/admin/firms/${parseInput(AdminFirmId, firmId)}/profile-changes`;

/**
 * `api.adminFirmProfile` (apps/web/src/lib/api.ts): a firm's Request Change tickets and applying
 * one, on the Super Admin's firm page. 401 without the Super Admin site's session, 403 for anyone
 * who is not a Super Admin, 404 for a ticket that is not this firm's. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. Screens show this module's
 * errors with `errorMessage(error, FIRM_PROFILE_ERRORS)`.
 */
export function createAdminFirmProfileClient(request: ApiRequest) {
  return {
    list: async (firmId: string): Promise<FirmProfileChanges> =>
      request(FirmProfileChanges, changes(firmId)),
    apply: async (
      firmId: string,
      ticketId: string,
      body: ApplyProfileChangeRequest,
    ): Promise<AppliedProfileChange> =>
      request(
        AppliedProfileChange,
        `${changes(firmId)}/${parseInput(ProfileChangeTicketId, ticketId)}/apply`,
        { method: 'POST', body: parseInput(ApplyProfileChangeRequest, body) },
      ),
  };
}
export type AdminFirmProfileClient = ReturnType<typeof createAdminFirmProfileClient>;
