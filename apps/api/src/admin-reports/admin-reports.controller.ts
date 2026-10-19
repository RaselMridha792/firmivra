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
import {
  AdminFeatureUsageQuery,
  AdminFirmsReportQuery,
  AdminReportExportRequest,
  AdminReportRange,
  AdminReportRunRequest,
  AdminSavedReportRunQuery,
  PlatformReportType,
  SaveAdminReportRequest,
  UpdateAdminReportRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminReportBuilderService } from './admin-report-builder.service.js';
import { AdminReportsService } from './admin-reports.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const uuid = pipe(z.uuid());

/**
 * Super Admin Reports & Analytics (R55; contract in packages/types/src/admin-reports). Super Admin
 * only; admin scope. Static paths come before ':id' ones.
 */
@Controller('admin/reports')
@Roles('SUPER_ADMIN')
export class AdminReportsController {
  constructor(
    private readonly reports: AdminReportsService,
    private readonly builder: AdminReportBuilderService,
  ) {}

  @Get('overview')
  overview(@Query(pipe(AdminReportRange)) q: Out<typeof AdminReportRange>) {
    return this.reports.overview(q);
  }

  @Get('revenue')
  revenue(@Query(pipe(AdminReportRange)) q: Out<typeof AdminReportRange>) {
    return this.reports.revenue(q);
  }

  @Get('users')
  users(@Query(pipe(AdminReportRange)) q: Out<typeof AdminReportRange>) {
    return this.reports.users(q);
  }

  @Get('feature-usage')
  featureUsage(@Query(pipe(AdminFeatureUsageQuery)) q: Out<typeof AdminFeatureUsageQuery>) {
    return this.reports.featureUsage(q);
  }

  @Get('support')
  support(@Query(pipe(AdminReportRange)) q: Out<typeof AdminReportRange>) {
    return this.reports.support(q);
  }

  @Get('firms')
  firms(@Query(pipe(AdminFirmsReportQuery)) q: Out<typeof AdminFirmsReportQuery>) {
    return this.reports.firms(q);
  }

  @Get('builder/fields')
  fields(@Query('type', pipe(PlatformReportType)) type: z.infer<typeof PlatformReportType>) {
    return this.builder.catalog(type);
  }

  @Post('builder/run')
  @HttpCode(200)
  run(@Body(pipe(AdminReportRunRequest)) body: Out<typeof AdminReportRunRequest>) {
    return this.builder.run(body);
  }

  @Post('builder/export')
  @HttpCode(200)
  export(@Body(pipe(AdminReportExportRequest)) body: Out<typeof AdminReportExportRequest>) {
    return this.builder.export(body);
  }

  @Get('saved')
  saved() {
    return this.builder.saved();
  }

  @Post('saved')
  save(@Body(pipe(SaveAdminReportRequest)) body: Out<typeof SaveAdminReportRequest>) {
    return this.builder.save(body);
  }

  @Patch('saved/:id')
  update(
    @Param('id', uuid) id: string,
    @Body(pipe(UpdateAdminReportRequest)) body: Out<typeof UpdateAdminReportRequest>,
  ) {
    return this.builder.update(id, body);
  }

  @Delete('saved/:id')
  remove(@Param('id', uuid) id: string) {
    return this.builder.remove(id);
  }

  @Post('saved/:id/run')
  @HttpCode(200)
  runSaved(
    @Param('id', uuid) id: string,
    @Query(pipe(AdminSavedReportRunQuery)) q: Out<typeof AdminSavedReportRunQuery>,
  ) {
    return this.builder.runSaved(id, q.page, q.pageSize);
  }

  @Post('saved/:id/duplicate')
  duplicate(@Param('id', uuid) id: string) {
    return this.builder.duplicate(id);
  }

  @Get('firms/:businessId')
  firm(
    @Param('businessId', uuid) businessId: string,
    @Query(pipe(AdminReportRange)) q: Out<typeof AdminReportRange>,
  ) {
    return this.reports.firm(businessId, q);
  }
}

@Module({
  controllers: [AdminReportsController],
  providers: [AdminPrisma, AdminReportsService, AdminReportBuilderService],
})
export class AdminReportsModule {}
