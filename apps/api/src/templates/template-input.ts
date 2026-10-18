import {
  ArchiveMessageTemplateRequest as ArchiveContract,
  BulkTemplatesRequest as BulkContract,
  CreateMessageTemplateRequest as CreateContract,
  CreateTemplateCategoryRequest as CreateCategoryContract,
  ImportTemplateRequest as ImportContract,
  MergeTemplateCategoryRequest as MergeCategoryContract,
  MessageTemplatesQuery as QueryContract,
  PreviewTemplateRequest as PreviewContract,
  ReorderTemplateCategoriesRequest as ReorderContract,
  SaveCustomMergeFieldRequest as CustomFieldContract,
  SaveTemplateBrandingRequest as BrandingContract,
  SetTemplateSharesRequest as SharesContract,
  StartTemplateAttachmentRequest as StartAttachmentContract,
  TemplateCategoriesQuery as CategoriesQueryContract,
  TestSendTemplateRequest as TestSendContract,
  UpdateMessageTemplateRequest as UpdateContract,
  UpdateTemplateCategoryRequest as UpdateCategoryContract,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500: a NUL character or half of a surrogate pair in any
// string (the body of a template is checked as text, not as markup, here).

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const TemplatesQuery = clean(QueryContract);
export const CreateTemplateBody = clean(CreateContract);
export const UpdateTemplateBody = clean(UpdateContract);
export const ArchiveTemplateBody = clean(ArchiveContract);
export const SharesBody = clean(SharesContract);
export const BulkBody = clean(BulkContract);
export const PreviewBody = clean(PreviewContract);
export const TestSendBody = clean(TestSendContract);
export const ImportBody = clean(ImportContract);
export const StartAttachmentBody = clean(StartAttachmentContract);
export const CategoriesQuery = clean(CategoriesQueryContract);
export const CreateCategoryBody = clean(CreateCategoryContract);
export const UpdateCategoryBody = clean(UpdateCategoryContract);
export const ReorderBody = clean(ReorderContract);
export const MergeCategoryBody = clean(MergeCategoryContract);
export const CustomFieldBody = clean(CustomFieldContract);
export const BrandingBody = clean(BrandingContract);
