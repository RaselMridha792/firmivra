import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminDashboard,
  ApproveFirmApplicationRequest,
  DeclineFirmApplicationRequest,
  FirmApplicationId,
  type FirmApplicationCounts,
  type FirmApplicationRecord,
  type FirmCounts,
  FirmId,
  type FirmRecord,
  ListFirmApplicationsQuery,
  type ListFirmApplicationsResponse,
  ListFirmsQuery,
  type ListFirmsResponse,
  RequestFirmInfoRequest,
  SaveFirmNotesRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from './admin-prisma.js';
import { FirmApplicationsService } from './firm-applications.service.js';
import { createFirmKeys, FIRM_KEYS, loadFirmKeysConfig } from './firm-keys.js';

/**
 * Firm applications for the Super Admin (R4; contract in packages/types/src/firm-applications):
 * the list with filters and pages, the counts, the review page, the review actions and approval.
 * Super Admins only (the Super Admin site's session); admin scope in the database, platform scope
 * only for approval's provisioning.
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

  @Get(':id')
  @Roles('SUPER_ADMIN')
  get(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.get(id);
  }

  /**
   * Creates the firm (with its KMS key) and invites its owner. 409 APPLICATION_DECIDED or
   * SLUG_TAKEN. Approved without a firm (a failure part way): picks up where it stopped.
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

  /** A new activation link for the firm's owner. 409 INVITE_NOT_NEEDED; 429 RATE_LIMITED. */
  @Post(':id/owner-invite')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  resendOwnerInvite(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.resendOwnerInvite(id);
  }

  /** Request Information: emails the applicant; stays pending. 409 APPLICATION_DECIDED. */
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
  // InvitesService: the new firm's owner is invited with R2's invites.
  imports: [SignInModule],
  controllers: [AdminFirmApplicationsController, AdminFirmsController, AdminDashboardController],
  providers: [
    AdminPrisma,
    FirmApplicationsService,
    // Settings are checked when the app starts, so a bad KMS_MODE never reaches an approval.
    { provide: FIRM_KEYS, useFactory: () => createFirmKeys(loadFirmKeysConfig()) },
  ],
})
export class FirmApplicationsModule {}
