import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import type { FirmUserList, UsersSummary } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { UsersQ } from './staff-input.js';
import { UsersService } from './users.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The UTF-8 byte order mark, so spreadsheets read the names right. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Settings > Users & Roles: the user table, its counters and the export. Owner and Admin only.
 * Invite User and the row actions are their own routes (users/invite, business/staff/...).
 */
@Controller('business/users')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(UsersQ)) q: Out<typeof UsersQ>,
  ): Promise<FirmUserList> {
    return this.users.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(@CurrentTenant() tenant: TenantContext): Promise<UsersSummary> {
    return this.users.summary(tenant);
  }

  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="users.csv"')
  async export(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(UsersQ)) q: Out<typeof UsersQ>,
  ): Promise<StreamableFile> {
    const text = await this.users.export(tenant, auth.userId, q);
    return new StreamableFile(Buffer.from(`${BOM}${text}`, 'utf8'), {
      type: 'text/csv; charset=utf-8',
    });
  }
}
