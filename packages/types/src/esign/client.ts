import { z } from 'zod';
import { ApiRequestError, type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import { FirmSlug, OkResponse } from '../schemas.js';
import { DownloadLink, type UploadFileFacts, UploadTicket } from '../documents/schemas.js';
import { ESIGN_ERRORS } from './errors.js';
import {
  ConfirmEsignUploadBody,
  EsignCorrectRecipientBody,
  CreateEsignRequestBody,
  CreateEsignUploadBody,
  EsignDocument,
  EsignDocumentId,
  EsignDownloadFile,
  EsignEventList,
  EsignFromVaultBody,
  EsignMergeValues,
  EsignReadiness,
  EsignRecipientId,
  EsignRequestDetail,
  EsignRequestId,
  EsignContentType,
  EsignRequestList,
  EsignStatus,
  EsignSummary,
  ListEsignRequestsQuery,
  MySignaturesStatus,
  EsignPutFieldsBody,
  EsignPutPagePlanBody,
  EsignPutRecipientsBody,
  EsignRemindBody,
  EsignReplaceBody,
  EsignResendCopyBody,
  SendEsignRequestBody,
  UpdateEsignRequestBody,
  EsignVoidBody,
} from './schemas.js';
import {
  EsignConsentVersion,
  EsignConsentVersionList,
  EsignSettings,
  EsignTemplateDetail,
  EsignTemplateId,
  EsignTemplateList,
  ListEsignTemplatesQuery,
  PublishEsignConsentBody,
  SaveEsignTemplateBody,
  UpdateEsignProfileBody,
  UpdateEsignSettingsBody,
  UpdateEsignTemplateBody,
  UseEsignTemplateBody,
} from './admin.js';
import {
  ListMySignaturesQuery,
  MySignatureList,
  SignerAcceptConsentBody,
  SignerAccessCodeBody,
  SignerAdoptBody,
  SignerAttachmentConfirmBody,
  SignerAttachmentUploadBody,
  SignerCodeSent,
  SignerConsent,
  SignerCopy,
  SignerCopyFile,
  SignerDeclineBody,
  SignerEnvelope,
  SignerField,
  SignerFinishBody,
  SignerSessionBody,
  SignerState,
  SignerVerifyCodeBody,
} from './signing.js';
import {
  DuplicateEsignTemplateBody,
  ESIGN_BULK_MAX,
  EsignApprovalBody,
  EsignBulkBatch,
  EsignBulkSendBody,
  EsignInPersonSession,
  EsignInPersonState,
  EsignMemberRole,
  EsignMemberRoleList,
  EsignReport,
  EsignReportQuery,
  EsignTemplateVersionList,
  ExitEsignInPersonBody,
  RestoreEsignTemplateVersionBody,
  SaveEsignTemplateVersionBody,
  SetEsignMemberRoleBody,
  StartEsignInPersonBody,
  SubmitEsignApprovalBody,
} from './extras.js';

const BASE = '/esign';
const one = (id: string) => `${BASE}/requests/${parseInput(EsignRequestId, id)}`;
const template = (id: string) => `${BASE}/templates/${parseInput(EsignTemplateId, id)}`;
const Uuid = z.uuid();
const Version = z.number().int().min(1);

/**
 * `api.esign` (apps/web/src/lib/api.ts): Firm Sign's signature requests, for the firm
 * (docs/api/esign.yaml). Every call but `status()` answers 403 MODULE_OFF when Firm Sign is off.
 * Upload a file with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.esign.createUpload(requestId, facts),
 *     finish: (uploadToken) => api.esign.confirmUpload(requestId, { uploadToken }),
 *   })
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * `baseUrl` is the one given to `createRequest` (for `documentContentUrl`).
 */
export function createEsignClient(request: ApiRequest, baseUrl = '/api/v1') {
  const post = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
    request(schema, path, { method: 'POST', body });
  const put = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
    request(schema, path, { method: 'PUT', body });
  return {
    /** Whether Firm Sign is on, and the caller's access in it. Never MODULE_OFF. */
    status: async (): Promise<EsignStatus> => request(EsignStatus, `${BASE}/status`),

    /** One page, newest activity first; pass `nextCursor` back as `cursor`. */
    list: async (query: ListEsignRequestsQuery = {}): Promise<EsignRequestList> =>
      request(
        EsignRequestList,
        `${BASE}/requests${toQuery(parseInput(ListEsignRequestsQuery, query))}`,
      ),
    /** The dashboard's 9 counters and the quick filters' counts. */
    summary: async (): Promise<EsignSummary> => request(EsignSummary, `${BASE}/requests/summary`),
    get: async (id: string): Promise<EsignRequestDetail> => request(EsignRequestDetail, one(id)),
    /** A new DRAFT. 409 ENGAGEMENT_MISMATCH. */
    create: async (body: CreateEsignRequestBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${BASE}/requests`, parseInput(CreateEsignRequestBody, body)),
    /** DRAFT only. 409 INVALID_STATE, ENGAGEMENT_MISMATCH or RECIPIENTS_LINKED. */
    update: async (id: string, body: UpdateEsignRequestBody): Promise<EsignRequestDetail> =>
      request(EsignRequestDetail, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateEsignRequestBody, body),
      }),
    /** Deletes a DRAFT that was never sent. 409 INVALID_STATE. */
    discard: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE' }),

    /**
     * Upload step 1 (DRAFT only). Takes `uploadFile()`'s facts: an Excel or Word file, which
     * uploadFile lets through, rejects here with 400 FILE_TYPE_NOT_ALLOWED before anything is sent.
     * Give the picker `accept` from ESIGN_UPLOAD_TYPES.
     */
    createUpload: async (
      id: string,
      body: CreateEsignUploadBody | UploadFileFacts,
    ): Promise<UploadTicket> => {
      if (!EsignContentType.safeParse(body.contentType).success) {
        throw new ApiRequestError(400, 'FILE_TYPE_NOT_ALLOWED', ESIGN_ERRORS.FILE_TYPE_NOT_ALLOWED);
      }
      return post(
        UploadTicket,
        `${one(id)}/documents/uploads`,
        parseInput(CreateEsignUploadBody, body),
      );
    },
    /** Upload step 3: the file's pages join the end of the page plan. */
    confirmUpload: async (id: string, body: ConfirmEsignUploadBody): Promise<EsignDocument> =>
      post(
        EsignDocument,
        `${one(id)}/documents/uploads/confirm`,
        parseInput(ConfirmEsignUploadBody, body),
      ),
    /** Copy one of the client's CLEAN PDF, JPG or PNG documents into the request. */
    addFromVault: async (id: string, body: EsignFromVaultBody): Promise<EsignDocument> =>
      post(EsignDocument, `${one(id)}/documents/from-vault`, parseInput(EsignFromVaultBody, body)),
    /** Removes a file, its pages and their fields (DRAFT only). */
    removeDocument: async (id: string, documentId: string): Promise<EsignRequestDetail> =>
      request(
        EsignRequestDetail,
        `${one(id)}/documents/${parseInput(EsignDocumentId, documentId)}`,
        { method: 'DELETE' },
      ),
    /**
     * Same-origin address of a file's bytes, for the page viewer (pdfjs fetches it with the
     * session cookie). 409 SCAN_PENDING or FILE_BLOCKED until the file is CLEAN. Not a call:
     * nothing is sent until the viewer loads it.
     */
    documentContentUrl: (id: string, documentId: string): string =>
      `${baseUrl}${one(id)}/documents/${parseInput(EsignDocumentId, documentId)}/content`,
    putPagePlan: async (id: string, body: EsignPutPagePlanBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/page-plan`, parseInput(EsignPutPagePlanBody, body)),
    putRecipients: async (id: string, body: EsignPutRecipientsBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/recipients`, parseInput(EsignPutRecipientsBody, body)),
    putFields: async (id: string, body: EsignPutFieldsBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/fields`, parseInput(EsignPutFieldsBody, body)),
    mergeValues: async (id: string): Promise<EsignMergeValues> =>
      request(EsignMergeValues, `${one(id)}/merge-values`),
    readiness: async (id: string): Promise<EsignReadiness> =>
      request(EsignReadiness, `${one(id)}/readiness`),
    /** 409 NOT_READY or INVALID_STATE. */
    send: async (id: string, body: SendEsignRequestBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/send`, parseInput(SendEsignRequestBody, body)),

    /** 409 REMIND_TOO_SOON or REQUEST_CLOSED. */
    remind: async (id: string, body: EsignRemindBody = {}): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/remind`, parseInput(EsignRemindBody, body)),
    /** 409 REQUEST_CLOSED. */
    void: async (id: string, body: EsignVoidBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/void`, parseInput(EsignVoidBody, body)),
    /** 409 RECIPIENT_DONE or REQUEST_CLOSED. */
    correctRecipient: async (
      id: string,
      recipientId: string,
      body: EsignCorrectRecipientBody,
    ): Promise<EsignRequestDetail> =>
      post(
        EsignRequestDetail,
        `${one(id)}/recipients/${parseInput(EsignRecipientId, recipientId)}/correct`,
        parseInput(EsignCorrectRecipientBody, body),
      ),
    /** Voids it and answers the new DRAFT. 409 REQUEST_CLOSED. */
    replace: async (id: string, body: EsignReplaceBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/replace`, parseInput(EsignReplaceBody, body)),
    /** COMPLETED only (409 INVALID_STATE). */
    resendCopy: async (id: string, body: EsignResendCopyBody = {}): Promise<OkResponse> =>
      post(OkResponse, `${one(id)}/resend-copy`, parseInput(EsignResendCopyBody, body)),
    /** A 5-minute download link. 409 INVALID_STATE before the file exists. */
    download: async (id: string, file: EsignDownloadFile): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${one(id)}/download${toQuery({ file: parseInput(EsignDownloadFile, file) })}`,
      ),
    /** The timeline, oldest first. */
    events: async (id: string): Promise<EsignEventList> =>
      request(EsignEventList, `${one(id)}/events`),

    /** A new template from this request (see SaveEsignTemplateBody). */
    saveAsTemplate: async (id: string, body: SaveEsignTemplateBody): Promise<EsignTemplateDetail> =>
      post(
        EsignTemplateDetail,
        `${one(id)}/save-as-template`,
        parseInput(SaveEsignTemplateBody, body),
      ),

    /** The request becomes the template's next version (see SaveEsignTemplateVersionBody). */
    saveAsVersion: async (
      id: string,
      body: SaveEsignTemplateVersionBody,
    ): Promise<EsignTemplateDetail> =>
      post(
        EsignTemplateDetail,
        `${one(id)}/save-as-version`,
        parseInput(SaveEsignTemplateVersionBody, body),
      ),

    /** DRAFT to NEEDS_APPROVAL. 409 NOT_READY or INVALID_STATE. */
    submitForApproval: async (
      id: string,
      body: SubmitEsignApprovalBody,
    ): Promise<EsignRequestDetail> =>
      post(
        EsignRequestDetail,
        `${one(id)}/submit-for-approval`,
        parseInput(SubmitEsignApprovalBody, body),
      ),
    /** An approver's decision. 403 NOT_AN_APPROVER; 409 INVALID_STATE or RECIPIENT_DONE. */
    decideApproval: async (id: string, body: EsignApprovalBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/approval`, parseInput(EsignApprovalBody, body)),

    /** In-person signing on this device (see StartEsignInPersonBody). */
    inPerson: {
      start: async (id: string, body: StartEsignInPersonBody): Promise<EsignInPersonSession> =>
        post(
          EsignInPersonSession,
          `${one(id)}/in-person`,
          parseInput(StartEsignInPersonBody, body),
        ),
      /** The caller's open session, if any. Works while locked. */
      state: async (): Promise<EsignInPersonState> =>
        request(EsignInPersonState, `${BASE}/in-person`),
      /** Unlock with the staff member's password. 400 PASSWORD_WRONG. Works while locked. */
      exit: async (body: ExitEsignInPersonBody): Promise<OkResponse> =>
        post(OkResponse, `${BASE}/in-person/exit`, parseInput(ExitEsignInPersonBody, body)),
    },

    /** Firm Sign access per member (Owner and Admin only; 403 FORBIDDEN otherwise). */
    roles: {
      list: async (): Promise<EsignMemberRoleList> => request(EsignMemberRoleList, `${BASE}/roles`),
      /** 409 ROLE_FIXED or NOT_A_MEMBER. */
      set: async (userId: string, body: SetEsignMemberRoleBody): Promise<EsignMemberRole> =>
        put(
          EsignMemberRole,
          `${BASE}/roles/${parseInput(Uuid, userId)}`,
          parseInput(SetEsignMemberRoleBody, body),
        ),
    },

    /** A bulk send's progress (see EsignBulkSendBody). */
    bulk: async (batchId: string): Promise<EsignBulkBatch> =>
      request(EsignBulkBatch, `${BASE}/bulk/${parseInput(Uuid, batchId)}`),

    /** Totals and activity by sender for a date range (see EsignReportQuery). */
    report: async (query: EsignReportQuery): Promise<EsignReport> =>
      request(EsignReport, `${BASE}/reports${toQuery(parseInput(EsignReportQuery, query))}`),

    /** Signing Settings. Changes are Owner and Admin only (403 FORBIDDEN). */
    settings: {
      get: async (): Promise<EsignSettings> => request(EsignSettings, `${BASE}/settings`),
      update: async (body: UpdateEsignSettingsBody): Promise<EsignSettings> =>
        put(EsignSettings, `${BASE}/settings`, parseInput(UpdateEsignSettingsBody, body)),
      consentVersions: async (): Promise<EsignConsentVersionList> =>
        request(EsignConsentVersionList, `${BASE}/settings/consent-versions`),
      publishConsent: async (body: PublishEsignConsentBody): Promise<EsignConsentVersion> =>
        post(
          EsignConsentVersion,
          `${BASE}/settings/consent-versions`,
          parseInput(PublishEsignConsentBody, body),
        ),
      /** The caller's own job title (any member). */
      updateMyProfile: async (body: UpdateEsignProfileBody): Promise<EsignSettings> =>
        put(EsignSettings, `${BASE}/me/profile`, parseInput(UpdateEsignProfileBody, body)),
    },

    /** Templates the caller may use: FIRM ones and their own PRIVATE ones. */
    templates: {
      list: async (query: ListEsignTemplatesQuery = {}): Promise<EsignTemplateList> =>
        request(
          EsignTemplateList,
          `${BASE}/templates${toQuery(parseInput(ListEsignTemplatesQuery, query))}`,
        ),
      get: async (templateId: string): Promise<EsignTemplateDetail> =>
        request(EsignTemplateDetail, template(templateId)),
      /** 409 TEMPLATE_NAME_TAKEN or TEMPLATE_ARCHIVED. */
      update: async (
        templateId: string,
        body: UpdateEsignTemplateBody,
      ): Promise<EsignTemplateDetail> =>
        request(EsignTemplateDetail, template(templateId), {
          method: 'PATCH',
          body: parseInput(UpdateEsignTemplateBody, body),
        }),
      /** Archived templates can't be used; requests made from them keep their copy. */
      archive: async (templateId: string): Promise<EsignTemplateDetail> =>
        post(EsignTemplateDetail, `${template(templateId)}/archive`, {}),
      /** Every saved version, newest first. */
      versions: async (templateId: string): Promise<EsignTemplateVersionList> =>
        request(EsignTemplateVersionList, `${template(templateId)}/versions`),
      /** Copies an older version into a new newest one. */
      restoreVersion: async (
        templateId: string,
        version: number,
        body: RestoreEsignTemplateVersionBody = {},
      ): Promise<EsignTemplateDetail> =>
        post(
          EsignTemplateDetail,
          `${template(templateId)}/versions/${parseInput(Version, version)}/restore`,
          parseInput(RestoreEsignTemplateVersionBody, body),
        ),
      /** A copy the caller owns. 409 TEMPLATE_NAME_TAKEN. */
      duplicate: async (
        templateId: string,
        body: DuplicateEsignTemplateBody,
      ): Promise<EsignTemplateDetail> =>
        post(
          EsignTemplateDetail,
          `${template(templateId)}/duplicate`,
          parseInput(DuplicateEsignTemplateBody, body),
        ),
      /**
       * One request per client; answers the batch (202). More than ESIGN_BULK_MAX clients rejects
       * here with 400 BULK_LIMIT before anything is sent.
       */
      bulkSend: async (templateId: string, body: EsignBulkSendBody): Promise<EsignBulkBatch> => {
        if (Array.isArray(body.clients) && body.clients.length > ESIGN_BULK_MAX) {
          throw new ApiRequestError(400, 'BULK_LIMIT', ESIGN_ERRORS.BULK_LIMIT);
        }
        return post(
          EsignBulkBatch,
          `${template(templateId)}/bulk-send`,
          parseInput(EsignBulkSendBody, body),
        );
      },
      /** A new DRAFT from the template. */
      use: async (templateId: string, body: UseEsignTemplateBody): Promise<EsignRequestDetail> =>
        post(
          EsignRequestDetail,
          `${template(templateId)}/use`,
          parseInput(UseEsignTemplateBody, body),
        ),
    },
  };
}

export type EsignClient = ReturnType<typeof createEsignClient>;

/**
 * `api.mySignatures(firmSlug)`: the signed-in client's Signature center at one firm (the client
 * comes from the session). Every call but `status()` answers 404 when Firm Sign is off.
 */
export function createMySignaturesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/signatures`;
  const mine = (recipientId: string) => `${base()}/${parseInput(EsignRecipientId, recipientId)}`;
  return {
    status: async (): Promise<MySignaturesStatus> =>
      request(MySignaturesStatus, `${base()}/status`),
    /** Requests where one of the client's logins is a recipient, newest first. */
    list: async (query: ListMySignaturesQuery = {}): Promise<MySignatureList> =>
      request(MySignatureList, `${base()}${toQuery(parseInput(ListMySignaturesQuery, query))}`),
    /**
     * Opens the signer pages for an ACTION_NEEDED row without an email code (the portal sign-in
     * counts). Sets the signer cookie; then use `api.signing(firmSlug)` from `consent` on.
     */
    startSigning: async (recipientId: string): Promise<SignerState> =>
      request(SignerState, `${mine(recipientId)}/session`, { method: 'POST', body: {} }),
    /** A COMPLETED request's signed PDF or certificate: a 5-minute link. */
    download: async (recipientId: string, file: SignerCopyFile): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${mine(recipientId)}/download${toQuery({ file: parseInput(SignerCopyFile, file) })}`,
      ),
  };
}

export type MySignaturesClient = ReturnType<typeof createMySignaturesClient>;

/**
 * `api.signing(firmSlug)`: the signer pages at /{slug}/sign#t=<token> (signing.ts). No account:
 * `session(token)` sets the signer cookie, and every other call uses it. 404 LINK_INVALID for any
 * bad, used, expired or other firm's link, and when the cookie is gone.
 * `baseUrl` is the one given to `createRequest` (for `packetUrl`).
 */
export function createSigningClient(request: ApiRequest, firmSlug: string, baseUrl = '/api/v1') {
  const base = () => `/portal/${parseInput(FirmSlug, firmSlug)}/sign`;
  const post = <S extends z.ZodType>(schema: S, path: string, body: unknown = {}) =>
    request(schema, `${base()}${path}`, { method: 'POST', body });
  return {
    /** Trade the link's token (from `#t=`) for the signer cookie. Call once, then drop the token. */
    session: async (token: string): Promise<SignerState> =>
      post(SignerState, '/session', parseInput(SignerSessionBody, { token })),
    /** Where the signer is now (after a reload). */
    state: async (): Promise<SignerState> => request(SignerState, `${base()}/state`),
    /** Leave: clears the cookie. */
    end: async (): Promise<OkResponse> => post(OkResponse, '/session/end'),

    sendCode: async (): Promise<SignerCodeSent> => post(SignerCodeSent, '/code/send'),
    verifyCode: async (body: SignerVerifyCodeBody): Promise<SignerState> =>
      post(SignerState, '/code/verify', parseInput(SignerVerifyCodeBody, body)),
    verifyAccessCode: async (body: SignerAccessCodeBody): Promise<SignerState> =>
      post(SignerState, '/access-code', parseInput(SignerAccessCodeBody, body)),

    consent: async (): Promise<SignerConsent> => request(SignerConsent, `${base()}/consent`),
    acceptConsent: async (body: SignerAcceptConsentBody): Promise<SignerState> =>
      post(SignerState, '/consent', parseInput(SignerAcceptConsentBody, body)),

    envelope: async (): Promise<SignerEnvelope> => request(SignerEnvelope, `${base()}/envelope`),
    /** The document's address for the page viewer (also `envelope().packetUrl`). Not a call. */
    packetUrl: (): string => `${baseUrl}${base()}/packet`,
    adopt: async (body: SignerAdoptBody): Promise<SignerEnvelope> =>
      post(SignerEnvelope, '/adopt', parseInput(SignerAdoptBody, body)),
    finish: async (body: SignerFinishBody): Promise<SignerState> =>
      post(SignerState, '/finish', parseInput(SignerFinishBody, body)),
    decline: async (body: SignerDeclineBody = {}): Promise<SignerState> =>
      post(SignerState, '/decline', parseInput(SignerDeclineBody, body)),

    /** An ATTACHMENT field's file, with `uploadFile()` (apps/web/src/lib/upload.ts). */
    createAttachmentUpload: async (body: SignerAttachmentUploadBody): Promise<UploadTicket> =>
      post(UploadTicket, '/attachments/uploads', parseInput(SignerAttachmentUploadBody, body)),
    confirmAttachment: async (body: SignerAttachmentConfirmBody): Promise<SignerField> =>
      post(
        SignerField,
        '/attachments/uploads/confirm',
        parseInput(SignerAttachmentConfirmBody, body),
      ),

    /** Step COPY: the completed request's files. */
    copy: async (): Promise<SignerCopy> => request(SignerCopy, `${base()}/copy`),
    downloadCopy: async (file: SignerCopyFile): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${base()}/copy/download${toQuery({ file: parseInput(SignerCopyFile, file) })}`,
      ),
  };
}

export type SigningClient = ReturnType<typeof createSigningClient>;
