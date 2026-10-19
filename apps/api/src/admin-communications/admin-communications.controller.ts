import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminCommContactList,
  type AdminCommConversation,
  AdminCommConversationId,
  type AdminCommConversationDetail,
  type AdminCommMessage,
  AdminCommMessageId,
  AdminCommSendRequest,
  type AdminCommSummary,
  type AdminCommTemplate,
  type AdminCommTemplateCategory,
  AdminCommTemplateCategoryId,
  type AdminCommTemplateCategoryList,
  AdminCommTemplateId,
  type AdminCommTemplatePreview,
  type AdminCommTestSent,
  CreateAdminCommMessageRequest,
  CreateAdminCommTemplateCategoryRequest,
  CreateAdminCommTemplateRequest,
  ListAdminCommContactsQuery,
  ListAdminCommConversationsQuery,
  type ListAdminCommConversationsResponse,
  ListAdminCommTemplatesQuery,
  type ListAdminCommTemplatesResponse,
  type OkResponse,
  PreviewAdminCommTemplateRequest,
  ScheduleAdminCommMessageRequest,
  TestAdminCommTemplateRequest,
  UpdateAdminCommConversationRequest,
  UpdateAdminCommMessageRequest,
  UpdateAdminCommTemplateCategoryRequest,
  UpdateAdminCommTemplateRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { CommInboxService } from './comm-inbox.service.js';
import { CommTemplatesService } from './comm-templates.service.js';
import { AdminBroadcastsController } from './admin-broadcasts.controller.js';
import { CommBroadcastsService } from './comm-broadcasts.service.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';

const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
const ConversationId = pipe(AdminCommConversationId);
const MessageId = pipe(AdminCommMessageId);
const TemplateId = pipe(AdminCommTemplateId);
const CategoryId = pipe(AdminCommTemplateCategoryId);

/**
 * Super Admin Communications, the inbox (contract: packages/types/src/admin-communications).
 * Static routes come before `:id`.
 */
@Controller('admin/communications')
@Roles('SUPER_ADMIN')
export class AdminCommunicationsController {
  constructor(
    private readonly inbox: CommInboxService,
    private readonly templates: CommTemplatesService,
  ) {}

  @Get('summary')
  summary(): Promise<AdminCommSummary> {
    return this.inbox.summary();
  }

  @Get('contacts')
  contacts(
    @Query(pipe(ListAdminCommContactsQuery)) q: z.output<typeof ListAdminCommContactsQuery>,
  ): Promise<AdminCommContactList> {
    return this.inbox.contacts(q);
  }

  // ----- Conversations -----

  @Get('conversations')
  conversations(
    @Query(pipe(ListAdminCommConversationsQuery))
    q: z.output<typeof ListAdminCommConversationsQuery>,
  ): Promise<ListAdminCommConversationsResponse> {
    return this.inbox.list(q);
  }

  @Get('conversations/:id')
  conversation(@Param('id', ConversationId) id: string): Promise<AdminCommConversationDetail> {
    return this.inbox.get(id);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@Param('id', ConversationId) id: string): Promise<AdminCommConversation> {
    return this.inbox.read(id);
  }

  @Patch('conversations/:id')
  updateConversation(
    @Param('id', ConversationId) id: string,
    @Body(pipe(UpdateAdminCommConversationRequest))
    b: z.output<typeof UpdateAdminCommConversationRequest>,
  ): Promise<AdminCommConversation> {
    return this.inbox.update(id, b);
  }

  // ----- Messages -----

  @Post('messages')
  @HttpCode(200)
  createMessage(
    @Body(pipe(CreateAdminCommMessageRequest)) b: z.output<typeof CreateAdminCommMessageRequest>,
  ): Promise<AdminCommMessage> {
    return this.inbox.create(b);
  }

  @Patch('messages/:id')
  updateMessage(
    @Param('id', MessageId) id: string,
    @Body(pipe(UpdateAdminCommMessageRequest)) b: z.output<typeof UpdateAdminCommMessageRequest>,
  ): Promise<AdminCommMessage> {
    return this.inbox.updateMessage(id, b);
  }

  @Post('messages/:id/send')
  @HttpCode(200)
  send(
    @Param('id', MessageId) id: string,
    @Body(pipe(AdminCommSendRequest)) _b: z.output<typeof AdminCommSendRequest>,
  ): Promise<AdminCommMessage> {
    return this.inbox.send(id);
  }

  @Post('messages/:id/schedule')
  @HttpCode(200)
  schedule(
    @Param('id', MessageId) id: string,
    @Body(pipe(ScheduleAdminCommMessageRequest))
    b: z.output<typeof ScheduleAdminCommMessageRequest>,
  ): Promise<AdminCommMessage> {
    return this.inbox.schedule(id, b);
  }

  @Post('messages/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', MessageId) id: string): Promise<AdminCommMessage> {
    return this.inbox.cancel(id);
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  retry(
    @Param('id', MessageId) id: string,
    @Body(pipe(AdminCommSendRequest)) b: z.output<typeof AdminCommSendRequest>,
  ): Promise<AdminCommMessage> {
    return this.inbox.retry(id, b.idempotencyKey);
  }

  @Delete('messages/:id')
  remove(@Param('id', MessageId) id: string): Promise<OkResponse> {
    return this.inbox.remove(id);
  }

  // ----- Templates -----

  @Get('templates')
  listTemplates(
    @Query(pipe(ListAdminCommTemplatesQuery)) q: z.output<typeof ListAdminCommTemplatesQuery>,
  ): Promise<ListAdminCommTemplatesResponse> {
    return this.templates.list(q);
  }

  @Post('templates')
  @HttpCode(200)
  createTemplate(
    @Body(pipe(CreateAdminCommTemplateRequest)) b: z.output<typeof CreateAdminCommTemplateRequest>,
  ): Promise<AdminCommTemplate> {
    return this.templates.create(b);
  }

  @Get('templates/:id')
  template(@Param('id', TemplateId) id: string): Promise<AdminCommTemplate> {
    return this.templates.get(id);
  }

  @Patch('templates/:id')
  updateTemplate(
    @Param('id', TemplateId) id: string,
    @Body(pipe(UpdateAdminCommTemplateRequest)) b: z.output<typeof UpdateAdminCommTemplateRequest>,
  ): Promise<AdminCommTemplate> {
    return this.templates.update(id, b);
  }

  @Post('templates/:id/duplicate')
  @HttpCode(200)
  duplicate(@Param('id', TemplateId) id: string): Promise<AdminCommTemplate> {
    return this.templates.duplicate(id);
  }

  @Post('templates/:id/archive')
  @HttpCode(200)
  archive(@Param('id', TemplateId) id: string): Promise<AdminCommTemplate> {
    return this.templates.archive(id);
  }

  @Post('templates/:id/preview')
  @HttpCode(200)
  preview(
    @Param('id', TemplateId) id: string,
    @Body(pipe(PreviewAdminCommTemplateRequest))
    b: z.output<typeof PreviewAdminCommTemplateRequest>,
  ): Promise<AdminCommTemplatePreview> {
    return this.templates.preview(id, b);
  }

  @Post('templates/:id/test')
  @HttpCode(200)
  test(
    @Param('id', TemplateId) id: string,
    @Body(pipe(TestAdminCommTemplateRequest)) b: z.output<typeof TestAdminCommTemplateRequest>,
  ): Promise<AdminCommTestSent> {
    return this.templates.test(id, b);
  }

  // ----- Categories -----

  @Get('template-categories')
  categories(): Promise<AdminCommTemplateCategoryList> {
    return this.templates.categories();
  }

  @Post('template-categories')
  @HttpCode(200)
  createCategory(
    @Body(pipe(CreateAdminCommTemplateCategoryRequest))
    b: z.output<typeof CreateAdminCommTemplateCategoryRequest>,
  ): Promise<AdminCommTemplateCategory> {
    return this.templates.createCategory(b);
  }

  @Patch('template-categories/:id')
  updateCategory(
    @Param('id', CategoryId) id: string,
    @Body(pipe(UpdateAdminCommTemplateCategoryRequest))
    b: z.output<typeof UpdateAdminCommTemplateCategoryRequest>,
  ): Promise<AdminCommTemplateCategory> {
    return this.templates.updateCategory(id, b);
  }
}

@Module({
  controllers: [AdminCommunicationsController, AdminBroadcastsController],
  providers: [
    AdminPrisma,
    CommInboxService,
    CommTemplatesService,
    CommBroadcastsService,
    // The documents bucket (platform/communications/ prefix), as DocumentsModule builds it.
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
  ],
})
export class AdminCommunicationsModule {}
