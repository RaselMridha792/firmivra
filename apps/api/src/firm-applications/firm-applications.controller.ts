import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminDashboard,
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
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from './admin-prisma.js';
import { FirmApplicationsService } from './firm-applications.service.js';

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
  controllers: [AdminFirmApplicationsController, AdminFirmsController, AdminDashboardController],
  providers: [AdminPrisma, FirmApplicationsService],
})
export class FirmApplicationsModule {}
