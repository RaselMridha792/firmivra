import { Controller, Get, Param } from '@nestjs/common';
import { type PublicPackage, ServicePackageId } from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogPackagesService } from './catalog-packages.service.js';

/**
 * Client Portal Review One SP-1 (Services & Pricing S7, S12): the page behind a package's public
 * link (`{PORTAL_BASE_URL}/{firmSlug}/packages/{id}`) reads the package here before anyone signs
 * in. Public: the firm comes from the slug (ACTIVE firms only; any other slug is 404), and the
 * package must be that firm's (404 otherwise). It shows only while LIVE (Active, Visible to
 * Clients, Display on Website/Portal), and never internal notes.
 */
@Controller('portal/:firmSlug/packages')
export class PublicPackagesController {
  constructor(
    private readonly portal: PortalInfoService,
    private readonly packages: CatalogPackagesService,
  ) {}

  @Get(':id')
  @Public()
  async get(
    @Param('firmSlug') firmSlug: string,
    @Param('id', new ZodValidationPipe(ServicePackageId)) id: string,
  ): Promise<PublicPackage> {
    const firm = await this.portal.activeFirm(firmSlug);
    return this.packages.publicPackage(firm.id, id);
  }
}
