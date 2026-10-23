import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type {
  LocationAction,
  LocationActionList,
  LocationActivity,
  LocationList,
  LocationOptions,
  LocationProfile,
  UploadPutTicket,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ConfirmLocationPhotoBody,
  CreateLocationBody,
  DeactivateLocationBody,
  DeactivateManagerBody,
  LocationActionsQ,
  LocationActivityQ,
  LocationPhotoUploadBody,
  LocationsQ,
  type Out,
  ReassignManagerBody,
  SetLocationStaffBody,
  UpdateLocationActionBody,
  UpdateLocationBody,
} from './locations-input.js';
import { LocationPhotoService } from './location-photo.service.js';
import { LocationsReadService } from './locations-read.service.js';
import { LocationsService } from './locations.service.js';

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * Settings > Locations (contract: packages/types/src/settings/locations.ts, `api.locations`).
 * Owner and Admin, like every Settings page; deactivating a location or a manager and editing or
 * cancelling a scheduled change also need the Super Administrator (the service checks: the Owner,
 * or an Admin with MANAGE on SETTINGS). Static routes come before `locations/:id`.
 */
@Controller('business')
@Roles(...FIRM_MANAGERS)
export class LocationsController {
  constructor(
    private readonly reads: LocationsReadService,
    private readonly locations: LocationsService,
    private readonly photos: LocationPhotoService,
  ) {}

  @Get('locations')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LocationsQ)) q: Out<typeof LocationsQ>,
  ): Promise<LocationList> {
    return this.reads.list(tenant.businessId, q);
  }

  @Get('locations/options')
  options(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LocationOptions> {
    return this.reads.options(tenant, auth.userId);
  }

  @Get('locations/actions')
  actions(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LocationActionsQ)) q: Out<typeof LocationActionsQ>,
  ): Promise<LocationActionList> {
    return this.reads.actions(tenant.businessId, q);
  }

  @Get('locations/activity')
  activity(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LocationActivityQ)) q: Out<typeof LocationActivityQ>,
  ): Promise<LocationActivity> {
    return this.reads.activity(tenant.businessId, q);
  }

  @Post('locations')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateLocationBody)) body: Out<typeof CreateLocationBody>,
  ): Promise<LocationProfile> {
    return this.locations.create(tenant, auth.userId, body);
  }

  @Post('locations/managers/:userId/deactivate')
  @HttpCode(200)
  deactivateManager(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('userId', idPipe) userId: string,
    @Body(new ZodValidationPipe(DeactivateManagerBody)) body: Out<typeof DeactivateManagerBody>,
  ): Promise<LocationAction> {
    return this.locations.deactivateManager(tenant, auth.userId, userId, body);
  }

  @Patch('locations/actions/:id')
  updateAction(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateLocationActionBody))
    body: Out<typeof UpdateLocationActionBody>,
  ): Promise<LocationAction> {
    return this.locations.updateAction(tenant, auth.userId, id, body);
  }

  @Post('locations/actions/:id/cancel')
  @HttpCode(200)
  cancelAction(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<LocationAction> {
    return this.locations.cancelAction(tenant, auth.userId, id);
  }

  @Get('locations/:id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LocationProfile> {
    return this.reads.get(tenant.businessId, id);
  }

  @Patch('locations/:id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateLocationBody)) body: Out<typeof UpdateLocationBody>,
  ): Promise<LocationProfile> {
    return this.locations.update(tenant, id, body);
  }

  @Post('locations/:id/primary')
  @HttpCode(200)
  setPrimary(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LocationProfile> {
    return this.locations.setPrimary(tenant, id);
  }

  @Post('locations/:id/activate')
  @HttpCode(200)
  activate(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LocationProfile> {
    return this.locations.activate(tenant, id);
  }

  @Post('locations/:id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DeactivateLocationBody)) body: Out<typeof DeactivateLocationBody>,
  ): Promise<LocationProfile> {
    return this.locations.deactivate(tenant, auth.userId, id, body);
  }

  @Post('locations/:id/manager')
  @HttpCode(200)
  reassignManager(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ReassignManagerBody)) body: Out<typeof ReassignManagerBody>,
  ): Promise<LocationProfile> {
    return this.locations.reassignManager(tenant, auth.userId, id, body);
  }

  @Put('locations/:id/staff')
  setStaff(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetLocationStaffBody)) body: Out<typeof SetLocationStaffBody>,
  ): Promise<LocationProfile> {
    return this.locations.setStaff(tenant, id, body);
  }

  @Post('locations/:id/photo/uploads')
  photoTicket(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(LocationPhotoUploadBody)) body: Out<typeof LocationPhotoUploadBody>,
  ): Promise<UploadPutTicket> {
    return this.photos.ticket(tenant.businessId, auth.userId, id, body);
  }

  @Post('locations/:id/photo/uploads/confirm')
  @HttpCode(200)
  confirmPhoto(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmLocationPhotoBody))
    body: Out<typeof ConfirmLocationPhotoBody>,
  ): Promise<LocationProfile> {
    return this.photos.confirm(tenant.businessId, auth.userId, id, body);
  }

  @Delete('locations/:id/photo')
  removePhoto(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LocationProfile> {
    return this.photos.remove(tenant.businessId, id);
  }
}
