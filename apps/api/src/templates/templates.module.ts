import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import {
  TemplateAttachmentsService,
  TemplateUploadTokens,
} from './template-attachments.service.js';
import { TemplateCategoriesService } from './template-categories.service.js';
import { TemplateFieldsService } from './template-fields.service.js';
import { TemplateReadService } from './template-read.service.js';
import { TemplateRenderService } from './template-render.service.js';
import {
  TemplateBrandingController,
  TemplateCategoriesController,
  TemplateMergeFieldsController,
} from './template-settings.controller.js';
import { TemplateStartersService } from './template-starters.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

/**
 * The Templates module (R55; contract in packages/types/src/templates): the library, versions,
 * sharing and favourites, categories, merge fields, Branding & Letterhead, attachments, import and
 * the 48 starter templates. `TemplateRenderService` is exported for Communications, Automations
 * and Appointments: they render a template with live data and record the use.
 */
@Module({
  controllers: [
    TemplatesController,
    TemplateCategoriesController,
    TemplateMergeFieldsController,
    TemplateBrandingController,
  ],
  providers: [
    TemplateReadService,
    TemplatesService,
    TemplateRenderService,
    TemplateCategoriesService,
    TemplateFieldsService,
    TemplateAttachmentsService,
    TemplateStartersService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: TemplateUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new TemplateUploadTokens(poolSecrets(env)),
    },
  ],
  exports: [TemplateRenderService, TemplateReadService],
})
export class TemplatesModule {}
