import {
  ApiRequestError,
  SUPPORT_ATTACHMENT_LIMITS,
  type SupportTicket as ApiTicket,
  type SupportTicketDetail as ApiTicketDetail,
  type SupportTicketPage as ApiTicketPage,
  type SupportTicketsQuery,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { mocked } from '../../../../../lib/mock';
import { uploadFile } from '../../../../../lib/upload';
import {
  adminSupport as mockSupport,
  type AttachmentInput,
  type NewTicket,
  type SupportTicket,
  type TicketChange,
  type TicketDetail,
  type TicketPage,
  type TicketQuery,
  type TicketStatus,
} from '../../../../../mocks/admin-support';

// The Support screens' data (R60): `api.adminSupport` (contract packages/types/src/admin-support),
// under the method names the screens were built with. Mock mode (NEXT_PUBLIC_API_MOCK=adminSupport)
// keeps mocks/admin-support.ts. What differs from the contract is handled here:
// - Escalated is a flag, not a status: an active escalated ticket shows as ESCALATED, and the
//   ESCALATED filter is `escalated: YES`.
// - Files go up first (upload ticket, PUT, then the action takes the tokens).
// - A file opens through a short-lived signed link.
// - A ticket's firm and contact are fixed (B2), so there is no Change Firm / Contact.

const ACTIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];

/** An active escalated ticket shows as ESCALATED (waiting on the customer stays waiting). */
function shown<T extends ApiTicket>(t: T): Omit<T, 'status'> & { status: TicketStatus } {
  const escalated =
    t.escalation !== null && t.status !== 'WAITING_ON_CUSTOMER' && ACTIVE.includes(t.status);
  return { ...t, status: escalated ? 'ESCALATED' : t.status };
}

/** The firm of each ticket the screens opened: files go under that firm's prefix. */
const firmOf = new Map<string, string>();

async function upload(firmId: string, files: AttachmentInput[]): Promise<string[]> {
  const tokens: string[] = [];
  for (const f of files) {
    if (!f.file) throw new ApiRequestError(400, 'VALIDATION_FAILED', `Choose ${f.name} again`);
    const file = f.file instanceof File ? f.file : new File([f.file], f.name, { type: f.type });
    tokens.push(
      await uploadFile(file, {
        start: (facts) => api.adminSupport.createUpload({ firmId, ...facts }),
        finish: (uploadToken) => Promise.resolve(uploadToken),
        maxBytes: SUPPORT_ATTACHMENT_LIMITS.maxBytes,
      }),
    );
  }
  return tokens;
}

/** The screen's query in the contract's terms (ESCALATED is the escalated filter). */
function apiQuery(query: TicketQuery): SupportTicketsQuery {
  const { statuses, ...rest } = query;
  const real = statuses?.filter((s): s is Exclude<TicketStatus, 'ESCALATED'> => s !== 'ESCALATED');
  return {
    ...rest,
    ...(real?.length ? { statuses: real } : {}),
    ...(statuses?.includes('ESCALATED') && !real?.length ? { escalated: 'YES' as const } : {}),
  };
}

const real = {
  me: () => api.adminSupport.me(),
  directory: () => api.adminSupport.directory(),
  settings: () => api.adminSupport.settings(),
  summary: () => api.adminSupport.summary(),
  tickets: async (query: TicketQuery = {}): Promise<TicketPage> => {
    const page: ApiTicketPage = await api.adminSupport.tickets(apiQuery(query));
    return { ...page, items: page.items.map(shown) as SupportTicket[] };
  },
  ticket: async (id: string): Promise<TicketDetail> => {
    const t: ApiTicketDetail = await api.adminSupport.ticket(id);
    firmOf.set(t.id, t.firm.id);
    return shown(t) as unknown as TicketDetail;
  },
  /** A link to open or save the file (signed, a few minutes). */
  attachmentUrl: async (ticketId: string, attachmentId: string): Promise<string> =>
    (await api.adminSupport.attachmentLink(ticketId, attachmentId)).url,
  createTicket: async (body: NewTicket): Promise<SupportTicket> => {
    const status = body.status;
    if (status !== 'OPEN' && status !== 'IN_PROGRESS' && status !== 'WAITING_ON_CUSTOMER')
      throw new ApiRequestError(400, 'VALIDATION_FAILED', 'Select a status.');
    const uploadTokens = await upload(body.firmId, body.attachments);
    const t = await api.adminSupport.createTicket({
      requestId: body.requestId,
      firmId: body.firmId,
      contactId: body.contactId,
      subject: body.subject,
      categoryId: body.categoryId,
      priorityId: body.priorityId,
      assignTo: body.assignTo,
      status,
      source: body.source,
      description: body.description,
      uploadTokens,
      internalNote: body.internalNote,
      notifyAssignee: body.notifyAssignee,
    });
    return shown(t) as SupportTicket;
  },
  updateTicket: async (id: string, body: TicketChange): Promise<SupportTicket> => {
    if (body.status === 'ESCALATED')
      throw new ApiRequestError(400, 'VALIDATION_FAILED', 'Escalate with a reason');
    const { status, ...rest } = body;
    return shown(
      await api.adminSupport.updateTicket(id, { ...rest, ...(status ? { status } : {}) }),
    ) as SupportTicket;
  },
  assign: async (id: string, body: { version: number; assignTo: string; notify: boolean }) =>
    shown(await api.adminSupport.assign(id, body)) as SupportTicket,
  escalate: async (id: string, body: { version: number; reason: string }) =>
    shown(await api.adminSupport.escalate(id, body)) as SupportTicket,
  merge: async (id: string, body: { version: number; sourceId: string }) =>
    shown(await api.adminSupport.merge(id, body)) as SupportTicket,
  reply: async (
    id: string,
    body: {
      mode: 'REPLY' | 'NOTE';
      body: string;
      sendToClient: boolean;
      attachments: AttachmentInput[];
    },
  ): Promise<SupportTicket> => {
    const firmId = firmOf.get(id) ?? (await api.adminSupport.ticket(id)).firm.id;
    const uploadTokens = await upload(firmId, body.attachments);
    return shown(
      await api.adminSupport.reply(id, {
        mode: body.mode,
        body: body.body,
        sendToClient: body.sendToClient,
        uploadTokens,
      }),
    ) as SupportTicket;
  },
  addAttachments: async (id: string, files: AttachmentInput[]): Promise<SupportTicket> => {
    const firmId = firmOf.get(id) ?? (await api.adminSupport.ticket(id)).firm.id;
    return shown(
      await api.adminSupport.addAttachments(id, { uploadTokens: await upload(firmId, files) }),
    ) as SupportTicket;
  },
  deleteTicket: (id: string, body: { version: number }) => api.adminSupport.deleteTicket(id, body),
  saveCategory: (body: { id?: string; name: string; description: string }) =>
    api.adminSupport.saveCategory(body),
  setCategoryActive: (id: string, active: boolean) =>
    api.adminSupport.setCategoryActive(id, active),
  savePriority: (body: Parameters<typeof api.adminSupport.savePriority>[0]) =>
    api.adminSupport.savePriority(body),
  setPriorityActive: (id: string, active: boolean) =>
    api.adminSupport.setPriorityActive(id, active),
  saveBusinessHours: (body: Parameters<typeof api.adminSupport.saveBusinessHours>[0]) =>
    api.adminSupport.saveBusinessHours(body),
  addHoliday: (body: { date: string; name: string }) => api.adminSupport.addHoliday(body),
  removeHoliday: (id: string) => api.adminSupport.removeHoliday(id),
  saveAssignment: (body: Parameters<typeof api.adminSupport.saveAssignment>[0]) =>
    api.adminSupport.saveAssignment(body),
  saveEscalation: (body: Parameters<typeof api.adminSupport.saveEscalation>[0]) =>
    api.adminSupport.saveEscalation(body),
  saveCanned: (body: { id?: string; title: string; body: string; categoryId: string | null }) =>
    api.adminSupport.saveCanned(body),
  setCannedActive: (id: string, active: boolean) => api.adminSupport.setCannedActive(id, active),
  saveNotifications: (body: Parameters<typeof api.adminSupport.saveNotifications>[0]) =>
    api.adminSupport.saveNotifications(body),
  savePermissions: (body: Parameters<typeof api.adminSupport.savePermissions>[0]) =>
    api.adminSupport.savePermissions(body),
};

/** The mock, with a URL for a file (as the real one gives). */
const mock = {
  ...mockSupport,
  attachmentUrl: async (ticketId: string, attachmentId: string) =>
    URL.createObjectURL(await mockSupport.attachmentFile(ticketId, attachmentId)),
};

/** What the Support screens call: the API, or the mock in mock mode. */
export const adminSupport: typeof real = mocked('adminSupport')
  ? (mock as unknown as typeof real)
  : real;
