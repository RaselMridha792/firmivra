import {
  BulkDocumentsRequest,
  CreateDocumentCategoryRequest,
  CreateDocumentFolderRequest,
  CreateLibraryUploadRequest,
  DocumentFolderId,
  LibraryQuery,
  ReorderDocumentFoldersRequest,
  ReviewDocumentRequest,
  UpdateDocumentCategoryRequest,
  UpdateDocumentFolderRequest,
  UpdateDocumentSettingsRequest,
  UpdateLibraryDocumentRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED: a NUL
// character or half of a surrogate pair in any string.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const IdParam = z.uuid();
export const FolderIdParam = DocumentFolderId;
export const LibraryQ = clean(LibraryQuery);
export const UploadBody = clean(CreateLibraryUploadRequest);
export const UpdateDocumentBody = clean(UpdateLibraryDocumentRequest);
export const ReviewBody = clean(ReviewDocumentRequest);
export const BulkBody = clean(BulkDocumentsRequest);
export const CreateFolderBody = clean(CreateDocumentFolderRequest);
export const UpdateFolderBody = clean(UpdateDocumentFolderRequest);
export const ReorderFoldersBody = clean(ReorderDocumentFoldersRequest);
export const CreateCategoryBody = clean(CreateDocumentCategoryRequest);
export const UpdateCategoryBody = clean(UpdateDocumentCategoryRequest);
export const UpdateSettingsBody = clean(UpdateDocumentSettingsRequest);
