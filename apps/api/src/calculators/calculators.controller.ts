import { Body, Controller, Get, Module, NotFoundException, Param, Patch } from '@nestjs/common';
import {
  type Calculator,
  CalculatorKey,
  type CalculatorList,
  type FirmCalculator,
  type FirmCalculatorList,
} from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, FIRM_STAFF, Public, Roles } from '../auth/decorators.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { ModulesModule } from '../common/modules/requires-module.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { UpdateBody } from './calculators.input.js';
import { CalculatorsService } from './calculators.service.js';

const keyPipe = new ZodValidationPipe(CalculatorKey);

/**
 * The firm's calculators (R12 step 5; contract in packages/types/src/calculators). Everyone at
 * the firm reads; Owner and Admin turn them on or off and edit the title and disclaimer (Staff
 * 403). No figures go over the wire (they live in packages/types by tax year), and nothing is
 * computed here. The firm comes from TenantGuard.
 */
@Controller('business/calculators')
@Roles(...FIRM_STAFF)
export class CalculatorsController {
  constructor(private readonly calculators: CalculatorsService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<FirmCalculatorList> {
    return { items: await this.calculators.list(tenant.businessId) };
  }

  @Patch(':key')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('key', keyPipe) key: CalculatorKey,
    @Body(new ZodValidationPipe(UpdateBody)) body: UpdateBody,
  ): Promise<FirmCalculator> {
    return this.calculators.update(tenant.businessId, key, body);
  }
}

/**
 * The calculators the firm offers its clients (portal): enabled ones only. The firm comes from
 * the `:firmSlug` and the client's own login there (TenantGuard).
 */
@Controller('portal/:firmSlug/me/calculators')
@Roles('CLIENT')
export class MyCalculatorsController {
  constructor(private readonly calculators: CalculatorsService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<CalculatorList> {
    if (tenant.kind !== 'client')
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    return { items: await this.calculators.mine(tenant.businessId) };
  }

  @Get(':key')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('key', keyPipe) key: CalculatorKey,
  ): Promise<Calculator> {
    if (tenant.kind !== 'client')
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    return this.calculators.mineOne(tenant.businessId, key);
  }
}

/**
 * The public calculators (no sign-in): /portal/{firmSlug}/calculators. The firm is the ACTIVE
 * one the slug names and its 'calculators' module must be on; otherwise 404.
 */
@Controller('portal/:firmSlug/calculators')
export class PublicCalculatorsController {
  constructor(private readonly calculators: CalculatorsService) {}

  @Get()
  @Public()
  async list(@Param('firmSlug') firmSlug: string): Promise<CalculatorList> {
    return { items: await this.calculators.publicList(firmSlug) };
  }

  @Get(':key')
  @Public()
  get(
    @Param('firmSlug') firmSlug: string,
    @Param('key', keyPipe) key: CalculatorKey,
  ): Promise<Calculator> {
    return this.calculators.publicOne(firmSlug, key);
  }
}

@Module({
  imports: [ModulesModule, PortalInfoModule],
  controllers: [CalculatorsController, MyCalculatorsController, PublicCalculatorsController],
  providers: [CalculatorsService],
})
export class CalculatorsModule {}
