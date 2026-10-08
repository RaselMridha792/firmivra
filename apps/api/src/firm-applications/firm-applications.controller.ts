import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  type AdminDashboard,
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
  SubmitFirmApplicationRequest,
  type SubmitFirmApplicationResponse,
} from '@firmivra/types';
import { Public, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from './admin-prisma.js';
import { EIN_HASH_KEY, loadEinHashKey } from './ein-hash.js';
import { FirmApplicationsService } from './firm-applications.service.js';
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

  @Get(':id')
  @Roles('SUPER_ADMIN')
  get(
    @Param('id', new ZodValidationPipe(FirmApplicationId)) id: string,
  ): Promise<FirmApplicationRecord> {
    return this.applications.get(id);
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
  ],
})
export class FirmApplicationsModule {}
