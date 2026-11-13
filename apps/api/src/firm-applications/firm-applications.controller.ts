import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  type AdminDashboard,
  ApproveFirmApplicationRequest,
  AssignFirmReviewerRequest,
  DeclineFirmApplicationRequest,
  FirmApplicationId,
  type FirmApplicationCounts,
  type FirmApplicationFileLink,
  type FirmApplicationRecord,
  type FirmApplicationReviewers,
  type FirmCounts,
  FirmId,
  type FirmRecord,
  ListFirmApplicationsQuery,
  type ListFirmApplicationsResponse,
  ListFirmsQuery,
  type ListFirmsResponse,
  RequestFirmInfoRequest,
  SaveFirmNotesRequest,
  SubmitFirmApplicationRequest,
  type SubmitFirmApplicationResponse,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { Public, Roles } from '../auth/decorators.js';
import { IDENTITY_PROVIDER } from '../auth/identity/identity-provider.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE } from '../notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { AdminPrisma } from './admin-prisma.js';
import { EIN_HASH_KEY, loadEinHashKey } from './ein-hash.js';
import { FirmApplicationsService } from './firm-applications.service.js';
import { FirmKeyJob } from './firm-key-job.js';
import { createFirmKeys, FIRM_KEYS, loadFirmKeysConfig } from './firm-keys.js';
import { createOwnerInvites, OWNER_INVITES } from './owner-invites.js';
import { FirmApplicationSubmitService } from './submit.service.js';

/**
 * "Create a Business Account" on the firm site (R4 step 2): public, no session. The API's
 * cross-site guard takes it only as JSON from the firm site's own origin, like every public POST.
 * A burst from one IP is stopped in memory first (as R3's sign-up routes are); the limits shared
 * by every API task are in the service.
 */
@Controller('firm-applications')
export class FirmApplicationsController {
  constructor(private readonly submits: FirmApplicationSubmitService) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(
    @Body(new ZodValidationPipe(SubmitFirmApplicationRequest))
    body: z.output<typeof SubmitFirmApplicationRequest>,
  ): Promise<SubmitFirmApplicationResponse> {
    return this.submits.submit(body);
  }
}

/**
 * Firm applications for the Super Admin (R4; contract in packages/types/src/firm-applications):
 * the list with filters and pages, the counts, and the review page. Super Admins only (the
 * Super Admin site's session); admin scope in the database.
 */
@Controller('admin/firm-applications')
export class AdminFirmApplicationsController {
  constructor(private readonly applications: FirmApplicationsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  list(
    @Query(new ZodValidationPipe(ListFirmApplicationsQuery))
    query: z.output<typeof ListFirmApplicationsQuery>,
  ): Promise<ListFirmApplicationsResponse> {
    return this.applications.list(query);
  }

  // Before ':id', so "counts" is never read as an id.
  @Get('counts')
  @Roles('SUPER_ADMIN')
  counts(): Promise<FirmApplicationCounts> {
    return this.applications.counts();
  }

  /** SA-APP-F06: who an application can be assigned to. Before ':id'. */
  @Get('reviewers')
  @Roles('SUPER_ADMIN')
  reviewers(): Promise<FirmApplicationReviewers> {
    return this.applications.reviewers();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  get(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.get(id);
  }

  /**
   * Approve: creates the firm and links it. 409 APPLICATION_DECIDED, SLUG_TAKEN or
   * OWNER_NAME_TOO_LONG. Approving an approved application that has no firm yet finishes it.
   */
  @Post(':id/approve')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  approve(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Body(new ZodValidationPipe(ApproveFirmApplicationRequest))
    body: z.output<typeof ApproveFirmApplicationRequest>,
  ): Promise<FirmApplicationRecord> {
    return this.applications.approve(id, body.slug);
  }

  /**
   * SA-APP-F02: the detail page was opened. Pending becomes In Review once; nothing else changes.
   * A POST, so reading the application never writes.
   */
  @Post(':id/open')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  open(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.open(id);
  }

  /** SA-APP-F06: assign, reassign or unassign the reviewer. Super Admin only. */
  @Put(':id/reviewer')
  @Roles('SUPER_ADMIN')
  assignReviewer(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Body(new ZodValidationPipe(AssignFirmReviewerRequest))
    body: z.output<typeof AssignFirmReviewerRequest>,
  ): Promise<FirmApplicationRecord> {
    return this.applications.assignReviewer(id, body.userId);
  }

  /** A response file's short-lived link, once scanned clean. 409 FILE_NOT_READY. */
  @Get(':id/files/:fileId')
  @Roles('SUPER_ADMIN')
  fileLink(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Param('fileId', new ZodValidationPipe(FirmApplicationId)) fileId: string,
  ): Promise<FirmApplicationFileLink> {
    return this.applications.fileLink(id, fileId);
  }

  /**
   * SA-APP-F03 Request Additional Information: emails the applicant a link to answer; the status
   * becomes Awaiting Information. 409 APPLICATION_DECIDED.
   */
  @Post(':id/request-info')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  requestInfo(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Body(new ZodValidationPipe(RequestFirmInfoRequest))
    body: z.output<typeof RequestFirmInfoRequest>,
  ): Promise<FirmApplicationRecord> {
    return this.applications.requestInfo(id, body.message);
  }

  /** Decline with the reason sent to the applicant. 409 APPLICATION_DECIDED. */
  @Post(':id/decline')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  decline(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Body(new ZodValidationPipe(DeclineFirmApplicationRequest))
    body: z.output<typeof DeclineFirmApplicationRequest>,
  ): Promise<FirmApplicationRecord> {
    return this.applications.decline(id, body.reason);
  }

  /**
   * "Resend owner invite": a new activation link for the firm's owner. 409 INVITE_NOT_NEEDED
   * (no firm yet, or the owner has joined); 429 RATE_LIMITED.
   */
  @Post(':id/owner-invite')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  resendOwnerInvite(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.resendOwnerInvite(id);
  }

  /** "Save Note" (also after a decision). */
  @Put(':id/notes')
  @Roles('SUPER_ADMIN')
  saveNotes(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
    @Body(new ZodValidationPipe(SaveFirmNotesRequest)) body: z.output<typeof SaveFirmNotesRequest>,
  ): Promise<FirmApplicationRecord> {
    return this.applications.saveNotes(id, body.notes);
  }
}

/** The firms page (N04): every firm with its owner, plan and status. */
@Controller('admin/firms')
export class AdminFirmsController {
  constructor(private readonly applications: FirmApplicationsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  list(
    @Query(new ZodValidationPipe(ListFirmsQuery)) query: z.output<typeof ListFirmsQuery>,
  ): Promise<ListFirmsResponse> {
    return this.applications.listFirms(query);
  }

  @Get('counts')
  @Roles('SUPER_ADMIN')
  counts(): Promise<FirmCounts> {
    return this.applications.firmCounts();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  get(@Param('id', new ZodValidationPipe(FirmId)) id: string): Promise<FirmRecord> {
    return this.applications.getFirm(id);
  }
}

/** The Super Admin dashboard's counts (F04a). */
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly applications: FirmApplicationsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  get(): Promise<AdminDashboard> {
    return this.applications.dashboard();
  }
}

@Module({
  imports: [SignInModule],
  controllers: [
    FirmApplicationsController,
    AdminFirmApplicationsController,
    AdminFirmsController,
    AdminDashboardController,
  ],
  providers: [
    AdminPrisma,
    FirmApplicationsService,
    FirmApplicationSubmitService,
    { provide: EIN_HASH_KEY, useFactory: () => loadEinHashKey() },
    { provide: FIRM_KEYS, useFactory: () => createFirmKeys(loadFirmKeysConfig()) },
    FirmKeyJob,
    {
      provide: OWNER_INVITES,
      inject: [DATABASE, IDENTITY_PROVIDER, NOTIFY_SERVICE, AuditService, ENV],
      useFactory: createOwnerInvites,
    },
    // The documents bucket (the applicants' response files), as DocumentsModule builds it.
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
  ],
})
export class FirmApplicationsModule {}
