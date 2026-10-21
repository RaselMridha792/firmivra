import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { UploadPutTicket } from '../documents/schemas.js';
import {
  AddSupportAttachmentsRequest,
  AddSupportHolidayRequest,
  AssignSupportTicketRequest,
  CreateSupportTicketRequest,
  CreateSupportUploadRequest,
  DeleteSupportTicketQuery,
  EscalateSupportTicketRequest,
  MergeSupportTicketRequest,
  ReplySupportTicketRequest,
  SaveSupportBusinessHoursRequest,
  SaveSupportCannedResponseRequest,
  SaveSupportCategoryRequest,
  SaveSupportPriorityRequest,
  SetSupportActiveRequest,
  SupportAssignmentRules,
  SupportAttachmentId,
  SupportAttachmentLink,
  SupportBusinessHours,
  SupportCannedResponse,
  SupportCannedResponseId,
  SupportCategory,
  SupportCategoryId,
  SupportDirectory,
  SupportEscalationRules,
  SupportHoliday,
  SupportHolidayId,
  SupportMe,
  SupportNotificationSettings,
  SupportOk,
  SupportPermissionGrid,
  SupportPriority,
  SupportPriorityId,
  SupportSettings,
  SupportSummary,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketId,
  SupportTicketPage,
  SupportTicketsQuery,
  UpdateSupportTicketRequest,
} from './schemas.js';

const BASE = '/admin/support';
const ticket = (id: string) => `${BASE}/tickets/${parseInput(SupportTicketId, id)}`;
const send = (method: string, body: unknown) => ({ method, body });

/** The list filter as a query string: several values in one parameter, comma separated. */
function ticketsQuery(query: SupportTicketsQuery): string {
  const q = parseInput(SupportTicketsQuery, query);
  return toQuery({
    ...q,
    statuses: q.statuses?.join(','),
    priorityIds: q.priorityIds?.join(','),
    categoryIds: q.categoryIds?.join(','),
  });
}

/**
 * `api.adminSupport` (apps/web/src/lib/api.ts): Super Admin Support (dashboard, Ticket Detail,
 * Support Settings). 401 without the Super Admin site's session, 403 for anyone who is not on the
 * Super Admin team, and 403 FORBIDDEN for an action the member's support role does not allow
 * (`me().permissions`). Changes to a ticket send its `version` (409 CONFLICT when stale). Bad
 * input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. Screens
 * show this module's errors with `errorMessage(error, SUPPORT_ERRORS)`.
 *
 * Files: `createUpload` answers where to PUT the file; the action that adds it (createTicket,
 * reply, addAttachments) takes the `uploadToken` and checks the stored file. `attachmentLink`
 * answers a 5-minute link once the virus check is clean.
 */
export function createAdminSupportClient(request: ApiRequest) {
  return {
    /** The signed-in member as a support agent, with their permissions. */
    me: async (): Promise<SupportMe> => request(SupportMe, `${BASE}/me`),
    /** Every firm with its contacts, and the team (the pickers). */
    directory: async (): Promise<SupportDirectory> =>
      request(SupportDirectory, `${BASE}/directory`),
    settings: async (): Promise<SupportSettings> => request(SupportSettings, `${BASE}/settings`),
    summary: async (): Promise<SupportSummary> => request(SupportSummary, `${BASE}/summary`),

    // Tickets
    tickets: async (query: SupportTicketsQuery = {}): Promise<SupportTicketPage> =>
      request(SupportTicketPage, `${BASE}/tickets${ticketsQuery(query)}`),
    ticket: async (id: string): Promise<SupportTicketDetail> =>
      request(SupportTicketDetail, ticket(id)),
    createUpload: async (body: CreateSupportUploadRequest): Promise<UploadPutTicket> =>
      request(
        UploadPutTicket,
        `${BASE}/uploads`,
        send('POST', parseInput(CreateSupportUploadRequest, body)),
      ),
    /** A retried submit with the same `requestId` answers the ticket it already made. */
    createTicket: async (body: CreateSupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${BASE}/tickets`,
        send('POST', parseInput(CreateSupportTicketRequest, body)),
      ),
    updateTicket: async (id: string, body: UpdateSupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        ticket(id),
        send('PATCH', parseInput(UpdateSupportTicketRequest, body)),
      ),
    assign: async (id: string, body: AssignSupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${ticket(id)}/assign`,
        send('POST', parseInput(AssignSupportTicketRequest, body)),
      ),
    escalate: async (id: string, body: EscalateSupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${ticket(id)}/escalate`,
        send('POST', parseInput(EscalateSupportTicketRequest, body)),
      ),
    /** Merges `sourceId` into ticket `id`; answers ticket `id`. */
    merge: async (id: string, body: MergeSupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${ticket(id)}/merge`,
        send('POST', parseInput(MergeSupportTicketRequest, body)),
      ),
    /** A reply (REPLY) or an internal note (NOTE). */
    reply: async (id: string, body: ReplySupportTicketRequest): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${ticket(id)}/replies`,
        send('POST', parseInput(ReplySupportTicketRequest, body)),
      ),
    addAttachments: async (
      id: string,
      body: AddSupportAttachmentsRequest,
    ): Promise<SupportTicket> =>
      request(
        SupportTicket,
        `${ticket(id)}/attachments`,
        send('POST', parseInput(AddSupportAttachmentsRequest, body)),
      ),
    attachmentLink: async (id: string, attachmentId: string): Promise<SupportAttachmentLink> =>
      request(
        SupportAttachmentLink,
        `${ticket(id)}/attachments/${parseInput(SupportAttachmentId, attachmentId)}/download`,
      ),
    /** Soft delete: the ticket leaves every list; it stays for the audit trail. */
    deleteTicket: async (id: string, query: DeleteSupportTicketQuery): Promise<SupportOk> =>
      request(SupportOk, `${ticket(id)}${toQuery(parseInput(DeleteSupportTicketQuery, query))}`, {
        method: 'DELETE',
      }),

    // Support Settings
    /** Creates a category, or renames the one with `id`. */
    saveCategory: async (
      body: SaveSupportCategoryRequest & { id?: string },
    ): Promise<SupportCategory> => {
      const { id, ...fields } = body;
      const input = parseInput(SaveSupportCategoryRequest, fields);
      return id === undefined
        ? request(SupportCategory, `${BASE}/settings/categories`, send('POST', input))
        : request(
            SupportCategory,
            `${BASE}/settings/categories/${parseInput(SupportCategoryId, id)}`,
            send('PATCH', input),
          );
    },
    setCategoryActive: async (id: string, active: boolean): Promise<SupportCategory> =>
      request(
        SupportCategory,
        `${BASE}/settings/categories/${parseInput(SupportCategoryId, id)}/active`,
        send('PUT', parseInput(SetSupportActiveRequest, { active })),
      ),
    savePriority: async (
      body: SaveSupportPriorityRequest & { id?: string },
    ): Promise<SupportPriority> => {
      const { id, ...fields } = body;
      const input = parseInput(SaveSupportPriorityRequest, fields);
      return id === undefined
        ? request(SupportPriority, `${BASE}/settings/priorities`, send('POST', input))
        : request(
            SupportPriority,
            `${BASE}/settings/priorities/${parseInput(SupportPriorityId, id)}`,
            send('PATCH', input),
          );
    },
    /** 422 LAST_ACTIVE_PRIORITY for the last active one. */
    setPriorityActive: async (id: string, active: boolean): Promise<SupportPriority> =>
      request(
        SupportPriority,
        `${BASE}/settings/priorities/${parseInput(SupportPriorityId, id)}/active`,
        send('PUT', parseInput(SetSupportActiveRequest, { active })),
      ),
    saveBusinessHours: async (
      body: SaveSupportBusinessHoursRequest,
    ): Promise<SupportBusinessHours> =>
      request(
        SupportBusinessHours,
        `${BASE}/settings/business-hours`,
        send('PUT', parseInput(SaveSupportBusinessHoursRequest, body)),
      ),
    addHoliday: async (body: AddSupportHolidayRequest): Promise<SupportHoliday> =>
      request(
        SupportHoliday,
        `${BASE}/settings/holidays`,
        send('POST', parseInput(AddSupportHolidayRequest, body)),
      ),
    removeHoliday: async (id: string): Promise<SupportOk> =>
      request(SupportOk, `${BASE}/settings/holidays/${parseInput(SupportHolidayId, id)}`, {
        method: 'DELETE',
      }),
    saveAssignment: async (body: SupportAssignmentRules): Promise<SupportAssignmentRules> =>
      request(
        SupportAssignmentRules,
        `${BASE}/settings/assignment`,
        send('PUT', parseInput(SupportAssignmentRules, body)),
      ),
    saveEscalation: async (body: SupportEscalationRules): Promise<SupportEscalationRules> =>
      request(
        SupportEscalationRules,
        `${BASE}/settings/escalation`,
        send('PUT', parseInput(SupportEscalationRules, body)),
      ),
    /** Creates a canned response, or changes the one with `id`. */
    saveCanned: async (
      body: SaveSupportCannedResponseRequest & { id?: string },
    ): Promise<SupportCannedResponse> => {
      const { id, ...fields } = body;
      const input = parseInput(SaveSupportCannedResponseRequest, fields);
      return id === undefined
        ? request(SupportCannedResponse, `${BASE}/settings/canned-responses`, send('POST', input))
        : request(
            SupportCannedResponse,
            `${BASE}/settings/canned-responses/${parseInput(SupportCannedResponseId, id)}`,
            send('PATCH', input),
          );
    },
    setCannedActive: async (id: string, active: boolean): Promise<SupportCannedResponse> =>
      request(
        SupportCannedResponse,
        `${BASE}/settings/canned-responses/${parseInput(SupportCannedResponseId, id)}/active`,
        send('PUT', parseInput(SetSupportActiveRequest, { active })),
      ),
    saveNotifications: async (
      body: SupportNotificationSettings,
    ): Promise<SupportNotificationSettings> =>
      request(
        SupportNotificationSettings,
        `${BASE}/settings/notifications`,
        send('PUT', parseInput(SupportNotificationSettings, body)),
      ),
    savePermissions: async (body: SupportPermissionGrid): Promise<SupportPermissionGrid> =>
      request(
        SupportPermissionGrid,
        `${BASE}/settings/permissions`,
        send('PUT', parseInput(SupportPermissionGrid, body)),
      ),
  };
}

export type AdminSupportClient = ReturnType<typeof createAdminSupportClient>;
