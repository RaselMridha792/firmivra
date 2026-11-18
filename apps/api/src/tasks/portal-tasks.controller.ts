import { Controller, Get, Param } from '@nestjs/common';
import { MyTaskId, type MyTask, type MyTaskList } from '@firmivra/types';
import { CurrentAuth, CurrentTenant, Roles } from '../auth/decorators.js';
import { PortalTabRoute } from '../client-portal/portal-tabs.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { PortalCaller } from '../storage/document-records.js';
import { PortalTasksService } from './portal-tasks.service.js';

/** The portal login from the session (TenantGuard's client account), never from the URL. */
function callerOf(auth: AuthContext, tenant: TenantContext): PortalCaller {
  if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
  return {
    businessId: tenant.businessId,
    userId: auth.userId,
    clientAccountId: tenant.clientAccountId,
  };
}

/**
 * Client Portal Review One T16: the signed-in client's visible tasks at one firm, in the
 * portal's Requests area, behind the per-client Tasks & Requests switch (403 MODULE_OFF when it
 * is off). Contract in packages/types/src/tasks/portal.ts.
 */
@Controller('portal/:firmSlug/me/tasks')
@Roles('CLIENT')
export class PortalTasksController {
  constructor(private readonly tasks: PortalTasksService) {}

  @Get()
  @PortalTabRoute('TASKS_REQUESTS')
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MyTaskList> {
    return { items: await this.tasks.list(callerOf(auth, tenant)) };
  }

  @Get(':id')
  @PortalTabRoute('TASKS_REQUESTS')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(MyTaskId)) id: string,
  ): Promise<MyTask> {
    return this.tasks.get(callerOf(auth, tenant), id);
  }
}
