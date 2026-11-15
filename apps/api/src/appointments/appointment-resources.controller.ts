import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AppointmentResources,
  CreateEquipmentRequest,
  CreateRoomRequest,
  EquipmentId,
  type FirmEquipment,
  type FirmRoom,
  RoomId,
  UpdateEquipmentRequest,
  UpdateRoomRequest,
} from '@firmivra/types';
import { Access, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentResourcesService } from './appointment-resources.service.js';
import { idParam } from './appointments.input.js';

const roomPipe = new ZodValidationPipe(idParam(RoomId));
const itemPipe = new ZodValidationPipe(idParam(EquipmentId));

/**
 * Appointments Review 2 (A2), Settings > Appointment Settings: the firm's rooms and equipment.
 * Owner and Admin only (Staff: 403); everyone books them through Schedule Appointment, whose
 * options list the live ones. The firm comes from TenantGuard.
 */
@Controller('business/appointment-resources')
@Access('APPOINTMENTS')
@Roles(...FIRM_MANAGERS)
export class AppointmentResourcesController {
  constructor(private readonly resources: AppointmentResourcesService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<AppointmentResources> {
    return this.resources.list(tenant.businessId);
  }

  @Post('rooms')
  addRoom(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateRoomRequest)) body: z.output<typeof CreateRoomRequest>,
  ): Promise<FirmRoom> {
    return this.resources.addRoom(tenant.businessId, body);
  }

  @Patch('rooms/:id')
  renameRoom(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', roomPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRoomRequest)) body: z.output<typeof UpdateRoomRequest>,
  ): Promise<FirmRoom> {
    return this.resources.renameRoom(tenant.businessId, id, body);
  }

  @Post('rooms/:id/archive')
  @HttpCode(200)
  archiveRoom(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', roomPipe) id: string,
  ): Promise<FirmRoom> {
    return this.resources.setRoomArchived(tenant.businessId, id, true);
  }

  @Post('rooms/:id/restore')
  @HttpCode(200)
  restoreRoom(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', roomPipe) id: string,
  ): Promise<FirmRoom> {
    return this.resources.setRoomArchived(tenant.businessId, id, false);
  }

  @Post('equipment')
  addEquipment(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateEquipmentRequest))
    body: z.output<typeof CreateEquipmentRequest>,
  ): Promise<FirmEquipment> {
    return this.resources.addEquipment(tenant.businessId, body);
  }

  @Patch('equipment/:id')
  updateEquipment(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', itemPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEquipmentRequest))
    body: z.output<typeof UpdateEquipmentRequest>,
  ): Promise<FirmEquipment> {
    return this.resources.updateEquipment(tenant.businessId, id, body);
  }

  @Post('equipment/:id/archive')
  @HttpCode(200)
  archiveEquipment(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', itemPipe) id: string,
  ): Promise<FirmEquipment> {
    return this.resources.setEquipmentArchived(tenant.businessId, id, true);
  }

  @Post('equipment/:id/restore')
  @HttpCode(200)
  restoreEquipment(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', itemPipe) id: string,
  ): Promise<FirmEquipment> {
    return this.resources.setEquipmentArchived(tenant.businessId, id, false);
  }
}
