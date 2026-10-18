import { Module } from '@nestjs/common';
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

/** The firm's Services & Pricing catalog (R55; contract in packages/types/src/services-pricing). */
@Module({
  controllers: [
    CatalogSummaryController,
    CatalogServicesController,
    CatalogCategoriesController,
    CatalogPackagesController,
    CatalogPromotionsController,
  ],
  providers: [
    CatalogServicesService,
    CatalogCategoriesService,
    CatalogPackagesService,
    CatalogPromotionsService,
  ],
})
export class CatalogModule {}
