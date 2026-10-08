import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type Availability,
  type BlockedTime,
  BlockedTimeId,
  type BlockedTimeList,
  type MemberAvailability,
  MemberId,
  type OkResponse,
  SetWorkingHoursRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BlocksQuery, CreateBlockBody } from './appointments.input.js';
import { AvailabilityService } from './availability.service.js';
import { firmActor } from './request-actors.js';

/**
 * Working hours (R12 step 2): everyone reads every active member's week; Owner and Admin set
 * anyone's, Staff their own (403 otherwise).
 */
@Controller('business/availability')
@Roles(...FIRM_STAFF)
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<Availability> {
    return this.availability.get(tenant.businessId);
  }

  @Put(':userId/working-hours')
  setWorkingHours(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('userId', new ZodValidationPipe(MemberId)) userId: string,
    @Body(new ZodValidationPipe(SetWorkingHoursRequest))
    body: z.output<typeof SetWorkingHoursRequest>,
  ): Promise<MemberAvailability> {
    return this.availability.setWorkingHours(
      tenant.businessId,
      firmActor(auth, tenant),
      userId,
      body,
    );
  }
}

/**
 * Blocked time (R12 step 2): everyone reads; Owner and Admin block anyone or the whole firm,
 * Staff only themselves (403 otherwise). A block over a scheduled appointment is 409.
 */
@Controller('business/blocked-times')
@Roles(...FIRM_STAFF)
export class BlockedTimesController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(BlocksQuery)) q: z.output<typeof BlocksQuery>,
  ): Promise<BlockedTimeList> {
    return { items: await this.availability.blockedTimes(tenant.businessId, q) };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateBlockBody)) body: z.output<typeof CreateBlockBody>,
  ): Promise<BlockedTime> {
    return this.availability.block(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(BlockedTimeId)) id: string,
  ): Promise<OkResponse> {
    return this.availability.unblock(tenant.businessId, firmActor(auth, tenant), id);
  }
}
