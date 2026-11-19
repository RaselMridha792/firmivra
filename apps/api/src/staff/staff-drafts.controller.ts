import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type {
  OkResponse,
  StaffDraft,
  StaffDraftAttachment,
  StaffDraftList,
  UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StaffDraftFilesService } from './staff-draft-files.service.js';
import {
  ConfirmStaffDocumentUploadBody,
  CreateStaffDraftUploadBody,
  SaveStaffDraftBody,
  StaffDraftAttachmentIdParam,
  StaffDraftIdParam,
} from './staff-input.js';
import { StaffRecordsService } from './staff-records.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffDraftIdParam);

/** Create Staff's Save as Draft (R55): no account, no invite, never pay. Owner and Admin. */
@Controller('business/staff-drafts')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class StaffDraftsController {
  constructor(
    private readonly records: StaffRecordsService,
    private readonly files: StaffDraftFilesService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<StaffDraftList> {
    return { items: await this.records.drafts(staffActorOf(auth, tenant)) };
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffDraft> {
    return this.records.draft(staffActorOf(auth, tenant), id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveStaffDraftBody)) body: Out<typeof SaveStaffDraftBody>,
  ): Promise<StaffDraft> {
    return this.records.saveDraft(staffActorOf(auth, tenant), body);
  }

  @Put(':id')
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveStaffDraftBody)) body: Out<typeof SaveStaffDraftBody>,
  ): Promise<StaffDraft> {
    return this.records.saveDraft(staffActorOf(auth, tenant), body, id);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.records.deleteDraft(staffActorOf(auth, tenant), id);
  }

  // ---------- SM17: files kept with the draft (Save under Remove) ----------

  @Post(':id/attachments/uploads')
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateStaffDraftUploadBody))
    body: Out<typeof CreateStaffDraftUploadBody>,
  ): Promise<UploadTicket> {
    return this.files.ticket(staffActorOf(auth, tenant), id, body);
  }

  @Post(':id/attachments/uploads/confirm')
  confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmStaffDocumentUploadBody))
    body: Out<typeof ConfirmStaffDocumentUploadBody>,
  ): Promise<StaffDraftAttachment> {
    return this.files.confirm(staffActorOf(auth, tenant), id, body.uploadToken);
  }

  @Delete(':id/attachments/:fileId')
  @HttpCode(200)
  removeFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('fileId', new ZodValidationPipe(StaffDraftAttachmentIdParam)) fileId: string,
  ): Promise<OkResponse> {
    return this.files.remove(staffActorOf(auth, tenant), id, fileId);
  }
}
