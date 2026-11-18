import { Module } from '@nestjs/common';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { CatalogCategoriesService } from './catalog-categories.service.js';
import { CatalogPackagesService } from './catalog-packages.service.js';
import { CatalogPromotionsService } from './catalog-promotions.service.js';
import { CatalogServicesService } from './catalog-services.service.js';
import {
  CatalogCategoriesController,
  CatalogPackagesController,
  CatalogPromotionsController,
  CatalogServicesController,
  CatalogSummaryController,
} from './catalog.controller.js';
import { PublicPackagesController } from './public-packages.controller.js';

/** The firm's Services & Pricing catalog (R55; contract in packages/types/src/services-pricing). */
@Module({
  // PortalInfoModule: SP-1's public package page finds the firm by its slug.
  imports: [PortalInfoModule],
  controllers: [
    CatalogSummaryController,
    CatalogServicesController,
    CatalogCategoriesController,
    CatalogPackagesController,
    CatalogPromotionsController,
    PublicPackagesController,
  ],
  providers: [
    CatalogServicesService,
    CatalogCategoriesService,
    CatalogPackagesService,
    CatalogPromotionsService,
  ],
})
export class CatalogModule {}
