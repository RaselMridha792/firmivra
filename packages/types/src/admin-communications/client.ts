import type { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  AdminCommContactList,
  AdminCommConversationDetail,
  AdminCommConversationId,
  AdminCommMessage,
  AdminCommMessageId,
  AdminCommSendRequest,
  AdminCommSummary,
  AdminCommTemplate,
  AdminCommTemplateCategory,
  AdminCommTemplateCategoryId,
  AdminCommTemplateCategoryList,
  AdminCommTemplateId,
  AdminCommTemplatePreview,
  AdminCommTestSent,
  AdminCommConversation,
  CreateAdminCommMessageRequest,
  CreateAdminCommTemplateCategoryRequest,
  CreateAdminCommTemplateRequest,
  ListAdminCommContactsQuery,
  ListAdminCommConversationsQuery,
  ListAdminCommConversationsResponse,
  ListAdminCommTemplatesQuery,
  ListAdminCommTemplatesResponse,
  PreviewAdminCommTemplateRequest,
  ScheduleAdminCommMessageRequest,
  TestAdminCommTemplateRequest,
  UpdateAdminCommConversationRequest,
  UpdateAdminCommMessageRequest,
  UpdateAdminCommTemplateCategoryRequest,
  UpdateAdminCommTemplateRequest,
} from './schemas.js';

const BASE = '/admin/communications';
const conversation = (id: string) =>
  `${BASE}/conversations/${parseInput(AdminCommConversationId, id)}`;
const message = (id: string) => `${BASE}/messages/${parseInput(AdminCommMessageId, id)}`;
const template = (id: string) => `${BASE}/templates/${parseInput(AdminCommTemplateId, id)}`;
const category = (id: string) =>
  `${BASE}/template-categories/${parseInput(AdminCommTemplateCategoryId, id)}`;

/**
 * `api.adminCommunications` (apps/web/src/lib/api.ts): the Super Admin Communications inbox,
 * New Message and Templates. 401 without the Super Admin site's session, 403 for anyone who is not
 * a Super Admin. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything
 * is sent. Screens show this module's errors with `errorMessage(error, ADMIN_COMM_ERRORS)`.
 * Every send, schedule, cancel, retry, assignment and status change is audited (ids only).
 */
export function createAdminCommunicationsClient(request: ApiRequest) {
  const post = <T extends z.ZodType>(schema: T, path: string, body: unknown = {}) =>
    request(schema, path, { method: 'POST', body });
  const patch = <T extends z.ZodType>(schema: T, path: string, body: unknown) =>
    request(schema, path, { method: 'PATCH', body });
  return {
    /** The cards above the inbox. */
    summary: async (): Promise<AdminCommSummary> => request(AdminCommSummary, `${BASE}/summary`),
    /** The New Message picker: firms' owners, sales contacts and the team (at most 20). */
    contacts: async (query: ListAdminCommContactsQuery = {}): Promise<AdminCommContactList> =>
      request(
        AdminCommContactList,
        `${BASE}/contacts${toQuery(parseInput(ListAdminCommContactsQuery, query))}`,
      ),

    conversations: {
      /** One page of a tab, newest first by default. */
      list: async (
        query: ListAdminCommConversationsQuery = {},
      ): Promise<ListAdminCommConversationsResponse> =>
        request(
          ListAdminCommConversationsResponse,
          `${BASE}/conversations${toQuery(parseInput(ListAdminCommConversationsQuery, query))}`,
        ),
      /** The thread with every message, its recipients and results. Reading changes nothing. */
      get: async (id: string): Promise<AdminCommConversationDetail> =>
        request(AdminCommConversationDetail, conversation(id)),
      /** Moves the signed-in member's read mark to now. */
      read: async (id: string): Promise<AdminCommConversation> =>
        post(AdminCommConversation, `${conversation(id)}/read`),
      /** Assignment, tags and status. 409 NOT_A_TEAM_MEMBER. */
      update: async (
        id: string,
        body: UpdateAdminCommConversationRequest,
      ): Promise<AdminCommConversation> =>
        patch(
          AdminCommConversation,
          conversation(id),
          parseInput(UpdateAdminCommConversationRequest, body),
        ),
    },

    messages: {
      /**
       * A draft, a message sent now, or a scheduled one, in a thread or a new one. 409
       * NO_DESTINATION, SCHEDULE_IN_PAST, TEMPLATE_NOT_USABLE, NOT_A_TEAM_MEMBER or
       * IDEMPOTENCY_CONFLICT. The same key again answers the message already made.
       */
      create: async (body: CreateAdminCommMessageRequest): Promise<AdminCommMessage> =>
        post(AdminCommMessage, `${BASE}/messages`, parseInput(CreateAdminCommMessageRequest, body)),
      /** A draft or scheduled message only. 409 NOT_EDITABLE. */
      update: async (id: string, body: UpdateAdminCommMessageRequest): Promise<AdminCommMessage> =>
        patch(AdminCommMessage, message(id), parseInput(UpdateAdminCommMessageRequest, body)),
      /** Sends a draft or scheduled message now. 409 NOT_EDITABLE or NO_DESTINATION. */
      send: async (id: string, body: AdminCommSendRequest): Promise<AdminCommMessage> =>
        post(AdminCommMessage, `${message(id)}/send`, parseInput(AdminCommSendRequest, body)),
      /** 409 NOT_EDITABLE or SCHEDULE_IN_PAST. */
      schedule: async (
        id: string,
        body: ScheduleAdminCommMessageRequest,
      ): Promise<AdminCommMessage> =>
        post(
          AdminCommMessage,
          `${message(id)}/schedule`,
          parseInput(ScheduleAdminCommMessageRequest, body),
        ),
      /** A scheduled message is cancelled and never goes out. 409 NOT_SCHEDULED. */
      cancel: async (id: string): Promise<AdminCommMessage> =>
        post(AdminCommMessage, `${message(id)}/cancel`),
      /**
       * A new message to the recipients that failed; the failed one stays in history. 409
       * NOT_RETRYABLE.
       */
      retry: async (id: string, body: AdminCommSendRequest): Promise<AdminCommMessage> =>
        post(AdminCommMessage, `${message(id)}/retry`, parseInput(AdminCommSendRequest, body)),
      /** Drafts only, with their recipients. 409 NOT_DRAFT. */
      remove: async (id: string): Promise<OkResponse> =>
        request(OkResponse, message(id), { method: 'DELETE' }),
    },

    templates: {
      list: async (
        query: ListAdminCommTemplatesQuery = {},
      ): Promise<ListAdminCommTemplatesResponse> =>
        request(
          ListAdminCommTemplatesResponse,
          `${BASE}/templates${toQuery(parseInput(ListAdminCommTemplatesQuery, query))}`,
        ),
      get: async (id: string): Promise<AdminCommTemplate> =>
        request(AdminCommTemplate, template(id)),
      /** 409 DUPLICATE_NAME or CATEGORY_INACTIVE. */
      create: async (body: CreateAdminCommTemplateRequest): Promise<AdminCommTemplate> =>
        post(
          AdminCommTemplate,
          `${BASE}/templates`,
          parseInput(CreateAdminCommTemplateRequest, body),
        ),
      /** 409 DUPLICATE_NAME or CATEGORY_INACTIVE; an archived template is NOT_FOUND here. */
      update: async (
        id: string,
        body: UpdateAdminCommTemplateRequest,
      ): Promise<AdminCommTemplate> =>
        patch(AdminCommTemplate, template(id), parseInput(UpdateAdminCommTemplateRequest, body)),
      /** A copy named "<name> (copy)", inactive. */
      duplicate: async (id: string): Promise<AdminCommTemplate> =>
        post(AdminCommTemplate, `${template(id)}/duplicate`),
      /** Archived, never deleted. */
      archive: async (id: string): Promise<AdminCommTemplate> =>
        post(AdminCommTemplate, `${template(id)}/archive`),
      preview: async (
        id: string,
        body: PreviewAdminCommTemplateRequest = {},
      ): Promise<AdminCommTemplatePreview> =>
        post(
          AdminCommTemplatePreview,
          `${template(id)}/preview`,
          parseInput(PreviewAdminCommTemplateRequest, body),
        ),
      /** To the signed-in member's email, or `phone` for a text template. */
      test: async (
        id: string,
        body: TestAdminCommTemplateRequest = {},
      ): Promise<AdminCommTestSent> =>
        post(
          AdminCommTestSent,
          `${template(id)}/test`,
          parseInput(TestAdminCommTemplateRequest, body),
        ),
    },

    categories: {
      list: async (): Promise<AdminCommTemplateCategoryList> =>
        request(AdminCommTemplateCategoryList, `${BASE}/template-categories`),
      /** 409 DUPLICATE_NAME. */
      create: async (
        body: CreateAdminCommTemplateCategoryRequest,
      ): Promise<AdminCommTemplateCategory> =>
        post(
          AdminCommTemplateCategory,
          `${BASE}/template-categories`,
          parseInput(CreateAdminCommTemplateCategoryRequest, body),
        ),
      /** 409 DUPLICATE_NAME or SYSTEM_CATEGORY (renaming a shipped one). */
      update: async (
        id: string,
        body: UpdateAdminCommTemplateCategoryRequest,
      ): Promise<AdminCommTemplateCategory> =>
        patch(
          AdminCommTemplateCategory,
          category(id),
          parseInput(UpdateAdminCommTemplateCategoryRequest, body),
        ),
    },
  };
}

export type AdminCommunicationsClient = ReturnType<typeof createAdminCommunicationsClient>;
