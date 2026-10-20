import {
  BulkDocumentsRequest,
  BulkRequestPacketsRequest,
  CancelRequestPacketRequest,
  CreateDocumentShareRequest,
  CreateRequestItemRequest,
  CreateRequestPacketRequest,
  CreateRequestTemplateRequest,
  ReorderRequestItemsRequest,
  RequestPacketsQuery,
  RequestTemplatesQuery,
  UpdateDocumentShareRequest,
  UpdateRequestItemRequest,
  UpdateRequestPacketRequest,
  UpdateRequestTemplateRequest,
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
export const CreateShareBody = clean(CreateDocumentShareRequest);
export const UpdateShareBody = clean(UpdateDocumentShareRequest);
export const PacketsQ = clean(RequestPacketsQuery);
export const CreatePacketBody = clean(CreateRequestPacketRequest);
export const UpdatePacketBody = clean(UpdateRequestPacketRequest);
export const CancelPacketBody = clean(CancelRequestPacketRequest);
export const BulkPacketsBody = clean(BulkRequestPacketsRequest);
export const CreateItemBody = clean(CreateRequestItemRequest);
export const UpdateItemBody = clean(UpdateRequestItemRequest);
export const ReorderItemsBody = clean(ReorderRequestItemsRequest);
export const TemplatesQ = clean(RequestTemplatesQuery);
export const CreateTemplateBody = clean(CreateRequestTemplateRequest);
export const UpdateTemplateBody = clean(UpdateRequestTemplateRequest);
