import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { ConfirmUploadRequest, UploadPutTicket } from '../documents/schemas.js';
import { OkResponse } from '../schemas.js';
import { MessageTemplateDetail, RenderedTemplate } from '../templates/schemas.js';
import {
  AnnouncementLocationList,
  AudienceCandidatePage,
  AudienceCandidatesQuery,
  AudienceSummary,
  CancelCommunicationRequest,
  CommunicationActivityPage,
  CommunicationActivityQuery,
  CommunicationAttachment,
  CommunicationAttachmentId,
  CommunicationDetail,
  CommunicationExport,
  CommunicationId,
  CommunicationPage,
  CommunicationRecipientPage,
  CommunicationRecipientsQuery,
  CommunicationResults,
  CommunicationReview,
  CommunicationSegmentId,
  CommunicationSenderList,
  CommunicationsOverview,
  CommunicationsQuery,
  ConsentQuery,
  ConsentView,
  CreateCommunicationRequest,
  CreateSegmentRequest,
  ExportCommunicationRequest,
  FollowUpRequest,
  PreviewCommunicationRequest,
  PreviewSegmentRequest,
  RescheduleCommunicationRequest,
  SaveAsTemplateRequest,
  ScheduleCommunicationRequest,
  SegmentDetail,
  SegmentFieldList,
  SegmentMemberPage,
  SegmentMembersQuery,
  SegmentPage,
  SegmentPreview,
  SegmentsQuery,
  SelectAllAudienceRequest,
  SelectAllAudienceResult,
  SendCommunicationRequest,
  SetAudienceRequest,
  SetConsentRequest,
  SetSegmentMembersRequest,
  StartCommunicationAttachmentRequest,
  TestSendCommunicationRequest,
  UpdateCommunicationRequest,
  UpdateSegmentRequest,
  UseTemplateRequest,
} from './schemas.js';

const BASE = '/business/communications';
const item = (id: string) => `${BASE}/${parseInput(CommunicationId, id)}`;
const segment = (id: string) => `${BASE}/segments/${parseInput(CommunicationSegmentId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.communications` (apps/web/src/lib/api.ts): the Communications module (contract in
 * ./schemas.ts). Everyone with the permission grid's COMMUNICATIONS view reads; creating, editing,
 * sending, scheduling, cancelling, exporting, resending, segments and consent need Create, Edit or
 * Manage (403 FORBIDDEN). Templates are the Templates module's (`api.templates`); merge fields are
 * `api.templates.mergeFields()`. Senders and provider readiness come from Integrations. Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. No business id
 * is ever sent. Make one `idempotencyKey` (a UUID) per send attempt and reuse it on a retry.
 * Upload an attachment with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.communications.startAttachment(id, facts),
 *     finish: (uploadToken) => api.communications.confirmAttachment({ uploadToken }),
 *   })
 */
export function createCommunicationsClient(request: ApiRequest) {
  return {
    // ----- Overview, lists, readiness -----
    overview: async (): Promise<CommunicationsOverview> =>
      request(CommunicationsOverview, `${BASE}/overview`),
    list: async (query: CommunicationsQuery = {}): Promise<CommunicationPage> =>
      request(CommunicationPage, `${BASE}${toQuery(parseInput(CommunicationsQuery, query))}`),
    /** Verified sender identities (from Integrations) for a channel. */
    senders: async (): Promise<CommunicationSenderList['items']> =>
      (await request(CommunicationSenderList, `${BASE}/senders`)).items,
    announcementLocations: async (): Promise<AnnouncementLocationList['items']> =>
      (await request(AnnouncementLocationList, `${BASE}/announcement-locations`)).items,

    // ----- Composer -----
    /** Starts a draft (the New Communication menu, or Use a Template). 409 CHANNEL_UNAVAILABLE, TEMPLATE_NOT_ALLOWED. */
    create: async (body: CreateCommunicationRequest): Promise<CommunicationDetail> =>
      request(CommunicationDetail, BASE, post(parseInput(CreateCommunicationRequest, body))),
    get: async (id: string): Promise<CommunicationDetail> => request(CommunicationDetail, item(id)),
    /** Autosave and Save Draft. 409 SAVE_CONFLICT, NOT_EDITABLE, CONTENT_WOULD_BE_LOST. */
    update: async (id: string, body: UpdateCommunicationRequest): Promise<CommunicationDetail> =>
      request(CommunicationDetail, item(id), {
        method: 'PATCH',
        body: parseInput(UpdateCommunicationRequest, body),
      }),
    /** A snapshot of the template is copied into the draft. */
    useTemplate: async (id: string, body: UseTemplateRequest): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/use-template`,
        post(parseInput(UseTemplateRequest, body)),
      ),
    /** A NEW template; an existing one is never changed. */
    saveAsTemplate: async (
      id: string,
      body: SaveAsTemplateRequest,
    ): Promise<MessageTemplateDetail> =>
      request(
        MessageTemplateDetail,
        `${item(id)}/save-as-template`,
        post(parseInput(SaveAsTemplateRequest, body)),
      ),
    preview: async (
      id: string,
      body: PreviewCommunicationRequest = {},
    ): Promise<RenderedTemplate> =>
      request(
        RenderedTemplate,
        `${item(id)}/preview`,
        post(parseInput(PreviewCommunicationRequest, body)),
      ),
    /** To the caller's own address or number; never a recipient. 400 TEST_SEND_REFUSED. */
    testSend: async (id: string, body: TestSendCommunicationRequest = {}): Promise<OkResponse> =>
      request(
        OkResponse,
        `${item(id)}/test-send`,
        post(parseInput(TestSendCommunicationRequest, body)),
      ),
    startAttachment: async (
      id: string,
      body: StartCommunicationAttachmentRequest,
    ): Promise<UploadPutTicket> =>
      request(
        UploadPutTicket,
        `${item(id)}/attachments/uploads`,
        post(parseInput(StartCommunicationAttachmentRequest, body)),
      ),
    /** Step 3 of the upload. The communication is found from the token. */
    confirmAttachment: async (body: ConfirmUploadRequest): Promise<CommunicationAttachment> =>
      request(
        CommunicationAttachment,
        `${BASE}/attachments/uploads/confirm`,
        post(parseInput(ConfirmUploadRequest, body)),
      ),
    removeAttachment: async (id: string, attachmentId: string): Promise<OkResponse> =>
      request(
        OkResponse,
        `${item(id)}/attachments/${parseInput(CommunicationAttachmentId, attachmentId)}`,
        { method: 'DELETE' },
      ),

    // ----- Recipients -----
    candidates: async (query: AudienceCandidatesQuery): Promise<AudienceCandidatePage> =>
      request(
        AudienceCandidatePage,
        `${BASE}/audience/candidates${toQuery(parseInput(AudienceCandidatesQuery, query))}`,
      ),
    /** Ids of every eligible record in the filtered scope, up to 1,000. */
    selectAll: async (body: SelectAllAudienceRequest): Promise<SelectAllAudienceResult> =>
      request(
        SelectAllAudienceResult,
        `${BASE}/audience/select-all`,
        post(parseInput(SelectAllAudienceRequest, body)),
      ),
    /** Apply / Done: replaces the audience and answers the recalculated summary. */
    setAudience: async (id: string, body: SetAudienceRequest): Promise<AudienceSummary> =>
      request(AudienceSummary, `${item(id)}/audience`, {
        method: 'PUT',
        body: parseInput(SetAudienceRequest, body),
      }),
    audience: async (id: string): Promise<AudienceSummary> =>
      request(AudienceSummary, `${item(id)}/audience`),

    // ----- Review and send -----
    review: async (id: string): Promise<CommunicationReview> =>
      request(CommunicationReview, `${item(id)}/review`),
    /** 409 NOT_READY, AUDIENCE_CHANGED, CHANNEL_UNAVAILABLE. A repeat with the same key is a no-op. */
    send: async (id: string, body: SendCommunicationRequest): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/send`,
        post(parseInput(SendCommunicationRequest, body)),
      ),
    schedule: async (
      id: string,
      body: ScheduleCommunicationRequest,
    ): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/schedule`,
        post(parseInput(ScheduleCommunicationRequest, body)),
      ),
    /** 409 LOCKED once the campaign is past its lock time. */
    reschedule: async (
      id: string,
      body: RescheduleCommunicationRequest,
    ): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/reschedule`,
        post(parseInput(RescheduleCommunicationRequest, body)),
      ),
    cancel: async (
      id: string,
      body: CancelCommunicationRequest = {},
    ): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/cancel`,
        post(parseInput(CancelCommunicationRequest, body)),
      ),
    pause: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/pause`, post()),
    resume: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/resume`, post()),
    /** Expire Now, for a published announcement. */
    expire: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/expire`, post()),
    archive: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/archive`, post()),
    restore: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/restore`, post()),

    // ----- Results -----
    results: async (id: string): Promise<CommunicationResults> =>
      request(CommunicationResults, `${item(id)}/results`),
    recipients: async (
      id: string,
      query: CommunicationRecipientsQuery = {},
    ): Promise<CommunicationRecipientPage> =>
      request(
        CommunicationRecipientPage,
        `${item(id)}/recipients${toQuery(parseInput(CommunicationRecipientsQuery, query))}`,
      ),
    activity: async (
      id: string,
      query: CommunicationActivityQuery = {},
    ): Promise<CommunicationActivityPage> =>
      request(
        CommunicationActivityPage,
        `${item(id)}/activity${toQuery(parseInput(CommunicationActivityQuery, query))}`,
      ),
    /** 403 EXPORT_NOT_ALLOWED. */
    exportResults: async (
      id: string,
      body: ExportCommunicationRequest = {},
    ): Promise<CommunicationExport> =>
      request(
        CommunicationExport,
        `${item(id)}/export`,
        post(parseInput(ExportCommunicationRequest, body)),
      ),
    /** A NEW draft from the snapshot. */
    duplicate: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/duplicate`, post()),
    /** A NEW draft for the eligible failed recipients. 409 NO_ELIGIBLE_RECIPIENTS. */
    resendFailed: async (id: string): Promise<CommunicationDetail> =>
      request(CommunicationDetail, `${item(id)}/resend-failed`, post()),
    /** A NEW draft for a result group, re-checked for consent. */
    followUp: async (id: string, body: FollowUpRequest): Promise<CommunicationDetail> =>
      request(
        CommunicationDetail,
        `${item(id)}/follow-up`,
        post(parseInput(FollowUpRequest, body)),
      ),

    // ----- Segments and lists -----
    segmentFields: async (): Promise<SegmentFieldList['items']> =>
      (await request(SegmentFieldList, `${BASE}/segments/fields`)).items,
    segments: async (query: SegmentsQuery = {}): Promise<SegmentPage> =>
      request(SegmentPage, `${BASE}/segments${toQuery(parseInput(SegmentsQuery, query))}`),
    createSegment: async (body: CreateSegmentRequest): Promise<SegmentDetail> =>
      request(SegmentDetail, `${BASE}/segments`, post(parseInput(CreateSegmentRequest, body))),
    segment: async (id: string): Promise<SegmentDetail> => request(SegmentDetail, segment(id)),
    updateSegment: async (id: string, body: UpdateSegmentRequest): Promise<SegmentDetail> =>
      request(SegmentDetail, segment(id), {
        method: 'PATCH',
        body: parseInput(UpdateSegmentRequest, body),
      }),
    /** The live matching count for criteria not saved yet. */
    previewSegment: async (body: PreviewSegmentRequest): Promise<SegmentPreview> =>
      request(
        SegmentPreview,
        `${BASE}/segments/preview`,
        post(parseInput(PreviewSegmentRequest, body)),
      ),
    segmentMembers: async (
      id: string,
      query: SegmentMembersQuery = {},
    ): Promise<SegmentMemberPage> =>
      request(
        SegmentMemberPage,
        `${segment(id)}/members${toQuery(parseInput(SegmentMembersQuery, query))}`,
      ),
    setSegmentMembers: async (id: string, body: SetSegmentMembersRequest): Promise<SegmentDetail> =>
      request(SegmentDetail, `${segment(id)}/members`, {
        method: 'PUT',
        body: parseInput(SetSegmentMembersRequest, body),
      }),
    duplicateSegment: async (id: string): Promise<SegmentDetail> =>
      request(SegmentDetail, `${segment(id)}/duplicate`, post()),
    /** 409 SEGMENT_IN_USE while a scheduled communication uses it. */
    archiveSegment: async (id: string): Promise<SegmentDetail> =>
      request(SegmentDetail, `${segment(id)}/archive`, post()),
    restoreSegment: async (id: string): Promise<SegmentDetail> =>
      request(SegmentDetail, `${segment(id)}/restore`, post()),

    // ----- Consent -----
    consent: async (query: ConsentQuery): Promise<ConsentView> =>
      request(ConsentView, `${BASE}/consent${toQuery(parseInput(ConsentQuery, query))}`),
    setConsent: async (body: SetConsentRequest): Promise<ConsentView> =>
      request(ConsentView, `${BASE}/consent`, {
        method: 'PUT',
        body: parseInput(SetConsentRequest, body),
      }),
  };
}
export type CommunicationsClient = ReturnType<typeof createCommunicationsClient>;
