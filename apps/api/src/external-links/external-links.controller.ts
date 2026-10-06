import { Body, Controller, Get, Post, Patch, Param, Module } from '@nestjs/common';
import { z } from 'zod';
import { CreateFirmExternalLinkRequest, UpdateFirmExternalLinkRequest } from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ExternalLinksService } from './external-links.service.js';
import { ExternalLinkIcons, PendingExternalLinkIcons } from './external-links.ports.js';
@Controller('business/external-links')
@Roles('OWNER', 'ADMIN')
export class FirmExternalLinksController {
  constructor(private readonly links: ExternalLinksService) {}
  @Get() list() {
    return this.links.list();
  }
  @Post() create(
    @Body(new ZodValidationPipe(CreateFirmExternalLinkRequest))
    body: z.output<typeof CreateFirmExternalLinkRequest>,
  ) {
    return this.links.create(body);
  }
  @Patch(':id') update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(UpdateFirmExternalLinkRequest))
    body: z.output<typeof UpdateFirmExternalLinkRequest>,
  ) {
    return this.links.update(id, body);
  }
}
@Controller('portal/:slug/external-links')
@Roles('CLIENT')
export class PortalExternalLinksController {
  constructor(private readonly links: ExternalLinksService) {}
  @Get() list() {
    return this.links.portal();
  }
}
@Module({
  controllers: [FirmExternalLinksController, PortalExternalLinksController],
  providers: [
    ExternalLinksService,
    { provide: ExternalLinkIcons, useClass: PendingExternalLinkIcons },
  ],
  exports: [ExternalLinksService],
})
export class ExternalLinksModule {}
