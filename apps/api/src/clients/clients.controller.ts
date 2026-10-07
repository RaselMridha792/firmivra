import {
  Body,
  Controller,
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
  ClientId,
  type ClientProfile,
  type ClientRecord,
  CreateClientRequest,
  ListClientsQuery,
  type ListClientsResponse,
  UpdateClientProfileRequest,
  UpdateClientRequest,
} from '@firmivra/types';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { type ClientsActor, ClientsService } from './clients.service.js';
import { MyProfileController } from './my-profile.controller.js';
import { MyProfileService } from './my-profile.service.js';
import { ClientTaxYearsController, MyTaxYearsController } from './tax-years.controller.js';
import { TaxYearsService } from './tax-years.service.js';

const idPipe = new ZodValidationPipe(ClientId);

/** The signed-in member as the clients service needs them. Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('clients routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * The firm's clients (R10 step 3; contract in packages/types/src/clients). Owner, Admin and
 * Staff (Staff: only clients assigned to them); archive and restore are Owner and Admin. The
 * firm comes from TenantGuard. The profile (step 4) keeps SSN, EIN and date of birth encrypted.
 */
@Controller('business/clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

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
  imports: [FieldEncryptionModule],
  controllers: [
    ClientsController,
    ClientTaxYearsController,
    MyTaxYearsController,
    MyProfileController,
  ],
  providers: [ClientsService, TaxYearsService, MyProfileService],
})
export class ClientsModule {}
