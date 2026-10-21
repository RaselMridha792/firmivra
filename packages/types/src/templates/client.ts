import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { ConfirmUploadRequest, DownloadLink, UploadPutTicket } from '../documents/schemas.js';
import { OkResponse } from '../schemas.js';
import {
  ArchiveMessageTemplateRequest,
  BulkTemplatesRequest,
  BulkTemplatesResult,
  CreateMessageTemplateRequest,
  CreateTemplateCategoryRequest,
  CustomMergeFieldId,
  ImportTemplateRequest,
  ImportTemplateResult,
  InstallStartersResult,
  MergeField,
  MergeFieldList,
  MergeTemplateCategoryRequest,
  MessageTemplateDetail,
  MessageTemplateId,
  MessageTemplatePage,
  MessageTemplatesQuery,
  PreviewTemplateRequest,
  RenderedTemplate,
  ReorderTemplateCategoriesRequest,
  SaveCustomMergeFieldRequest,
  SaveTemplateBrandingRequest,
  SetTemplateSharesRequest,
  StarterTemplatesStatus,
  StartTemplateAttachmentRequest,
  TemplateAttachment,
  TemplateAttachmentId,
  TemplateBranding,
  TemplateCategory,
  TemplateCategoriesQuery,
  TemplateCategoryId,
  TemplateCategoryList,
  TemplatesSummary,
  TemplateVersion,
  TemplateVersionNumber,
  TemplateVersionList,
  TestSendTemplateRequest,
  UpdateMessageTemplateRequest,
  UpdateTemplateCategoryRequest,
} from './schemas.js';

const TEMPLATES = '/business/templates';
const template = (id: string) => `${TEMPLATES}/${parseInput(MessageTemplateId, id)}`;
const category = (id: string) =>
  `/business/template-categories/${parseInput(TemplateCategoryId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.templates` (apps/web/src/lib/api.ts): the Templates module (contract in ./schemas.ts).
 * Everyone with the permission grid's TEMPLATES view reads the templates they may see; changes
 * need Create, Edit or Manage (403 FORBIDDEN). Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. No business id is ever sent. Upload an
 * attachment with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.templates.startAttachment(templateId, facts),
 *     finish: (uploadToken) => api.templates.confirmAttachment({ uploadToken }),
 *   })
 */
export function createTemplatesClient(request: ApiRequest) {
  return {
    // ----- Library -----
    summary: async (): Promise<TemplatesSummary> =>
      request(TemplatesSummary, `${TEMPLATES}/summary`),
    list: async (query: MessageTemplatesQuery = {}): Promise<MessageTemplatePage> =>
      request(
        MessageTemplatePage,
        `${TEMPLATES}${toQuery(parseInput(MessageTemplatesQuery, query))}`,
      ),
    get: async (id: string): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, template(id)),
    create: async (body: CreateMessageTemplateRequest): Promise<MessageTemplateDetail> =>
      request(
        MessageTemplateDetail,
        TEMPLATES,
        post(parseInput(CreateMessageTemplateRequest, body)),
      ),
    /** 409 SAVE_CONFLICT or AUTOMATION_IN_USE. */
    update: async (
      id: string,
      body: UpdateMessageTemplateRequest,
    ): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, template(id), {
        method: 'PATCH',
        body: parseInput(UpdateMessageTemplateRequest, body),
      }),
    duplicate: async (id: string): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, `${template(id)}/duplicate`, post()),
    /** 409 AUTOMATION_IN_USE until confirmed. */
    archive: async (
      id: string,
      body: ArchiveMessageTemplateRequest = {},
    ): Promise<MessageTemplateDetail> =>
      request(
        MessageTemplateDetail,
        `${template(id)}/archive`,
        post(parseInput(ArchiveMessageTemplateRequest, body)),
      ),
    restore: async (id: string): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, `${template(id)}/restore`, post()),
    /** The caller's own favourite; it never changes anyone else's. */
    favorite: async (id: string): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, `${template(id)}/favorite`, { method: 'PUT' }),
    unfavorite: async (id: string): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, `${template(id)}/favorite`, { method: 'DELETE' }),
    setShares: async (id: string, body: SetTemplateSharesRequest): Promise<MessageTemplateDetail> =>
      request(MessageTemplateDetail, `${template(id)}/shares`, {
        method: 'PUT',
        body: parseInput(SetTemplateSharesRequest, body),
      }),
    bulk: async (body: BulkTemplatesRequest): Promise<BulkTemplatesResult> =>
      request(
        BulkTemplatesResult,
        `${TEMPLATES}/bulk`,
        post(parseInput(BulkTemplatesRequest, body)),
      ),

    // ----- Versions -----
    versions: async (id: string): Promise<TemplateVersionList['items']> =>
      (await request(TemplateVersionList, `${template(id)}/versions`)).items,
    version: async (id: string, version: number): Promise<TemplateVersion> =>
      request(
        TemplateVersion,
        `${template(id)}/versions/${parseInput(TemplateVersionNumber, version)}`,
      ),
    /** Makes a new version from an old one; nothing is lost. */
    restoreVersion: async (id: string, version: number): Promise<MessageTemplateDetail> =>
      request(
        MessageTemplateDetail,
        `${template(id)}/versions/${parseInput(TemplateVersionNumber, version)}/restore`,
        post(),
      ),

    // ----- Preview and test send -----
    preview: async (id: string, body: PreviewTemplateRequest = {}): Promise<RenderedTemplate> =>
      request(
        RenderedTemplate,
        `${template(id)}/preview`,
        post(parseInput(PreviewTemplateRequest, body)),
      ),
    /** To the caller's own address or number, marked as a test. 400 TEST_SEND_REFUSED. */
    testSend: async (id: string, body: TestSendTemplateRequest): Promise<OkResponse> =>
      request(
        OkResponse,
        `${template(id)}/test-send`,
        post(parseInput(TestSendTemplateRequest, body)),
      ),

    // ----- Attachments -----
    startAttachment: async (
      id: string,
      body: StartTemplateAttachmentRequest,
    ): Promise<UploadPutTicket> =>
      request(
        UploadPutTicket,
        `${template(id)}/attachments/uploads`,
        post(parseInput(StartTemplateAttachmentRequest, body)),
      ),
    /** Step 3 of the upload. The template is found from the token. */
    confirmAttachment: async (body: ConfirmUploadRequest): Promise<TemplateAttachment> =>
      request(
        TemplateAttachment,
        `${TEMPLATES}/attachments/uploads/confirm`,
        post(parseInput(ConfirmUploadRequest, body)),
      ),
    attachmentLink: async (id: string, attachmentId: string): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${template(id)}/attachments/${parseInput(TemplateAttachmentId, attachmentId)}/download`,
      ),
    removeAttachment: async (id: string, attachmentId: string): Promise<OkResponse> =>
      request(
        OkResponse,
        `${template(id)}/attachments/${parseInput(TemplateAttachmentId, attachmentId)}`,
        {
          method: 'DELETE',
        },
      ),

    // ----- Import and starters -----
    importTemplate: async (body: ImportTemplateRequest): Promise<ImportTemplateResult> =>
      request(
        ImportTemplateResult,
        `${TEMPLATES}/import`,
        post(parseInput(ImportTemplateRequest, body)),
      ),
    starters: async (): Promise<StarterTemplatesStatus> =>
      request(StarterTemplatesStatus, `${TEMPLATES}/starters`),
    installStarters: async (): Promise<InstallStartersResult> =>
      request(InstallStartersResult, `${TEMPLATES}/starters`, post()),

    // ----- Categories -----
    categories: async (query: TemplateCategoriesQuery = {}): Promise<TemplateCategory[]> =>
      (
        await request(
          TemplateCategoryList,
          `/business/template-categories${toQuery(parseInput(TemplateCategoriesQuery, query))}`,
        )
      ).items,
    createCategory: async (body: CreateTemplateCategoryRequest): Promise<TemplateCategory> =>
      request(
        TemplateCategory,
        '/business/template-categories',
        post(parseInput(CreateTemplateCategoryRequest, body)),
      ),
    updateCategory: async (
      id: string,
      body: UpdateTemplateCategoryRequest,
    ): Promise<TemplateCategory> =>
      request(TemplateCategory, category(id), {
        method: 'PATCH',
        body: parseInput(UpdateTemplateCategoryRequest, body),
      }),
    reorderCategories: async (
      body: ReorderTemplateCategoriesRequest,
    ): Promise<TemplateCategory[]> =>
      (
        await request(TemplateCategoryList, '/business/template-categories/order', {
          method: 'PUT',
          body: parseInput(ReorderTemplateCategoriesRequest, body),
        })
      ).items,
    mergeCategory: async (
      id: string,
      body: MergeTemplateCategoryRequest,
    ): Promise<TemplateCategory> =>
      request(
        TemplateCategory,
        `${category(id)}/merge`,
        post(parseInput(MergeTemplateCategoryRequest, body)),
      ),
    archiveCategory: async (id: string): Promise<TemplateCategory> =>
      request(TemplateCategory, `${category(id)}/archive`, post()),
    restoreCategory: async (id: string): Promise<TemplateCategory> =>
      request(TemplateCategory, `${category(id)}/restore`, post()),

    // ----- Merge fields and branding -----
    /** The searchable panel: built-in groups and the firm's custom fields. */
    mergeFields: async (): Promise<MergeField[]> =>
      (await request(MergeFieldList, '/business/template-merge-fields')).items,
    createMergeField: async (body: SaveCustomMergeFieldRequest): Promise<MergeField> =>
      request(
        MergeField,
        '/business/template-merge-fields',
        post(parseInput(SaveCustomMergeFieldRequest, body)),
      ),
    updateMergeField: async (id: string, body: SaveCustomMergeFieldRequest): Promise<MergeField> =>
      request(MergeField, `/business/template-merge-fields/${parseInput(CustomMergeFieldId, id)}`, {
        method: 'PUT',
        body: parseInput(SaveCustomMergeFieldRequest, body),
      }),
    /** 409 FIELD_IN_USE when templates use it. */
    deleteMergeField: async (id: string): Promise<OkResponse> =>
      request(OkResponse, `/business/template-merge-fields/${parseInput(CustomMergeFieldId, id)}`, {
        method: 'DELETE',
      }),
    branding: async (): Promise<TemplateBranding> =>
      request(TemplateBranding, '/business/template-branding'),
    saveBranding: async (body: SaveTemplateBrandingRequest): Promise<TemplateBranding> =>
      request(TemplateBranding, '/business/template-branding', {
        method: 'PUT',
        body: parseInput(SaveTemplateBrandingRequest, body),
      }),
  };
}
export type TemplatesClient = ReturnType<typeof createTemplatesClient>;
