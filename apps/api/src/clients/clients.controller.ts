import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  BulkClientsRequest,
  type BulkClientsResponse,
  type ClientExportLink,
  ClientId,
  type ClientProfile,
  type ClientRecord,
  type ClientsSummary,
  CreateClientRequest,
  ExportClientsRequest,
  ListClientsQuery,
  type ListClientsResponse,
  UpdateClientProfileRequest,
  UpdateClientRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { type ClientsActor, ClientsService } from './clients.service.js';
import { MyProfileController } from './my-profile.controller.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { ReportsModule } from '../reports/reports.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { ClientTimelineController, ClientTimelineService } from './client-timeline.controller.js';
import { ClientOfficeController, ClientOfficeService } from './client-office.controller.js';
import { ClientLinksController, ClientLinksService } from './client-links.controller.js';
import { ClientServicesController, ClientServicesService } from './client-services.controller.js';
import { MyProfileService } from './my-profile.service.js';
import { ClientTaxYearsController, MyTaxYearsController } from './tax-years.controller.js';
import { TaxYearsService } from './tax-years.service.js';

const idPipe = new ZodValidationPipe(ClientId);

/** The signed-in member as the clients service needs them. Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('clients routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}

/**
 * The firm's clients (R10 step 3; contract in packages/types/src/clients). Owner, Admin and
 * Staff (Staff: only clients assigned to them); archive and restore are Owner and Admin. The
 * firm comes from TenantGuard. The profile (step 4) keeps SSN, EIN and date of birth encrypted.
 */
@Controller('business/clients')
@Access('CLIENTS')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly grants: PermissionGrantsService,
  ) {}

  @Get()
  @Roles(...FIRM_STAFF)
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListClientsQuery)) query: z.output<typeof ListClientsQuery>,
  ): Promise<ListClientsResponse> {
    return this.clients.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Post()
  @Roles(...FIRM_STAFF)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateClientRequest)) body: z.output<typeof CreateClientRequest>,
  ): Promise<ClientRecord> {
    return this.clients.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  // Static routes before ':id'.

  /** The list's KPI cards and tab counts (Staff: their own clients). */
  @Get('summary')
  @Roles(...FIRM_STAFF)
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ClientsSummary> {
    return this.clients.summary(tenant.businessId, actorOf(auth, tenant));
  }

  /** Owner and Admin: assign, archive or restore up to 100 clients (each change audited). */
  @Post('bulk')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkClientsRequest)) body: z.output<typeof BulkClientsRequest>,
  ): Promise<BulkClientsResponse> {
    return this.clients.bulk(tenant.businessId, actorOf(auth, tenant), body);
  }

  /**
   * E2 additions: the list's clients as a CSV (Clients EXPORT in the member's grid; 403
   * otherwise). Staff export only their own clients, as the list.
   */
  @Post('export')
  @HttpCode(200)
  @Roles(...FIRM_STAFF)
  @Access('CLIENTS', 'EXPORT')
  async exportList(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ExportClientsRequest)) body: z.output<typeof ExportClientsRequest>,
  ): Promise<ClientExportLink> {
    // The Owner always; anyone else only when their own grid grants it (`@Access` lets Owner,
    // Admin and Staff through on their role, so the grid is read here).
    if (
      tenant.kind !== 'staff' ||
      (legacyFirmRole(tenant.role) !== 'OWNER' &&
        !(await this.grants.canTenant(tenant, 'CLIENTS', 'EXPORT')))
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action',
      });
    }
    return this.clients.exportList(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get(':id')
  @Roles(...FIRM_STAFF)
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientRecord> {
    return this.clients.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  @Roles(...FIRM_STAFF)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateClientRequest)) body: z.output<typeof UpdateClientRequest>,
  ): Promise<ClientRecord> {
    return this.clients.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  /** SSN, EIN and date of birth are stored only through the field-encryption helper. */
  @Put(':id/profile')
  @Roles(...FIRM_STAFF)
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateClientProfileRequest))
    body: z.output<typeof UpdateClientProfileRequest>,
  ): Promise<ClientProfile> {
    return this.clients.updateProfile(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientRecord> {
    return this.clients.archive(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/restore')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientRecord> {
    return this.clients.restore(tenant.businessId, actorOf(auth, tenant), id);
  }
}

@Module({
  // The export writes under the firm's reports prefix (ReportsModule's file store).
  imports: [FieldEncryptionModule, NotificationsModule, ReportsModule],
  controllers: [
    ClientsController,
    ClientTaxYearsController,
    MyTaxYearsController,
    MyProfileController,
    ClientTimelineController,
    ClientServicesController,
    ClientOfficeController,
    ClientLinksController,
  ],
  providers: [
    ClientsService,
    TaxYearsService,
    MyProfileService,
    ClientTimelineService,
    ClientServicesService,
    ClientOfficeService,
    ClientLinksService,
  ],
})
export class ClientsModule {}
